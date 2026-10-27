import { randomBytes } from "node:crypto";
import {
  addBlocker,
  allSlots,
  cloneWorld,
  createWorld,
  removeBlocker,
  slotInfo,
  startProblem,
  step,
  type Config,
  type Inputs,
  type PieceInput,
  type RoomState,
  type ServerMessage,
  type SlotId,
  type TickInput,
  type World,
} from "@puck/shared";

/** A connected client, as the room sees it. */
export interface Conn {
  send(msg: ServerMessage): void;
}

interface Player {
  id: string;
  token: string;
  name: string;
  slot: SlotId | null;
  conn: Conn | null;
  /** ms timestamp of the disconnect, while disconnected. */
  disconnectedAt: number | null;
  /** Targets currently in effect; they persist until a newer input changes them. */
  current: PieceInput;
  /** Per-tick inputs not yet applied, oldest first (one is consumed per sim tick). */
  queue: TickInput[];
  /** Highest seq received, to drop duplicates. Reset when the client reconnects. */
  lastQueuedSeq: number;
  /** Seq of the last input applied; echoed in snapshots so the client can reconcile. */
  ackSeq: number;
}

/**
 * One game room: lobby slots plus the authoritative sim (DESIGN.md "Rooms and slots").
 * Time comes from `now()` so tests can drive it; `update()` runs whatever ticks are due.
 */
export class Room {
  readonly players = new Map<string, Player>();
  hostId: string | null = null;
  phase: "lobby" | "playing" = "lobby";
  world: World | null = null;

  private nextPlayerId = 1;
  private lastTickAt = 0;
  private ticksSinceSnapshot = 0;

  constructor(
    readonly code: string,
    private readonly cfg: Config,
    private readonly now: () => number,
    /** Picks the first kickoff team (DESIGN.md "Faceoff"); the sim itself stays seeded. */
    private readonly random: () => number = Math.random,
  ) {}

  /** Adds a player, or reattaches one presenting a known token. */
  join(conn: Conn, rawName: string, token?: string): Player {
    const name = cleanName(rawName, this.cfg.room.nameMaxLength);
    let player = token ? [...this.players.values()].find((p) => p.token === token) : undefined;
    if (player) {
      player.conn = conn;
      player.disconnectedAt = null;
      player.name = name;
      // A reloaded client restarts its seq counter.
      player.queue = [];
      player.lastQueuedSeq = -1;
      player.ackSeq = -1;
    } else {
      player = {
        id: `p${this.nextPlayerId++}`,
        token: randomBytes(12).toString("hex"),
        name,
        slot: null,
        conn,
        disconnectedAt: null,
        current: {},
        queue: [],
        lastQueuedSeq: -1,
        ackSeq: -1,
      };
      this.players.set(player.id, player);
    }
    this.hostId ??= player.id;
    conn.send({ t: "welcome", room: this.code, playerId: player.id, token: player.token });
    this.broadcastRoom();
    if (this.world) conn.send(this.snapshot());
    return player;
  }

  /** Socket closed: keep the slot for the grace period. */
  disconnect(playerId: string, conn: Conn): void {
    const p = this.players.get(playerId);
    if (!p || p.conn !== conn) return; // a newer connection already took over
    p.conn = null;
    p.disconnectedAt = this.now();
    p.queue = [];
    this.reassignHost();
    this.broadcastRoom();
  }

  pickSlot(playerId: string, slot: SlotId | null): string | null {
    const p = this.players.get(playerId);
    if (!p) return "not in room";
    if (slot === p.slot) return null;
    if (slot !== null) {
      if (!slotInfo(this.cfg, slot)) return "no such slot";
      if ([...this.players.values()].some((o) => o.slot === slot)) return "slot taken";
    }
    this.vacate(p);
    p.slot = slot;
    const info = slot === null ? undefined : slotInfo(this.cfg, slot);
    if (this.world && info?.kind === "blocker") addBlocker(this.world, this.cfg, info.team, info.index);
    this.broadcastRoom();
    return null;
  }

  /** Why the match can't start yet, or null if it can. */
  startProblem(): string | null {
    return startProblem(this.cfg, [...this.players.values()].map((p) => p.slot));
  }

  start(playerId: string): string | null {
    if (playerId !== this.hostId) return "only the host can start";
    if (this.phase === "playing") return "already playing";
    const problem = this.startProblem();
    if (problem) return problem;

    const world = createWorld(this.cfg, 0, this.random() < 0.5 ? 0 : 1);
    for (const s of this.occupiedSlots()) {
      if (s.kind === "blocker") addBlocker(world, this.cfg, s.team, s.index);
    }
    this.world = world;
    this.phase = "playing";
    this.lastTickAt = this.now();
    this.ticksSinceSnapshot = 0;
    for (const p of this.players.values()) {
      p.current = {};
      p.queue = [];
    }
    this.broadcastRoom();
    this.broadcast(this.snapshot());
    return null;
  }

  stop(playerId: string): string | null {
    if (playerId !== this.hostId) return "only the host can end the match";
    this.phase = "lobby";
    this.world = null;
    this.broadcastRoom();
    return null;
  }

  /**
   * Queues a client's per-tick inputs. They only ever drive that player's own piece; the
   * sim clamps and rate-limits whatever they ask for.
   */
  input(playerId: string, inputs: TickInput[]): void {
    const p = this.players.get(playerId);
    if (!p || p.slot === null) return;
    for (const entry of inputs) {
      if (entry.seq <= p.lastQueuedSeq) continue;
      p.queue.push(entry);
      p.lastQueuedSeq = entry.seq;
    }
  }

  /** Runs due ticks, sends snapshots, expires disconnected players. */
  update(): void {
    this.expireDisconnected();
    if (!this.world) return;

    const tickMs = 1000 / this.cfg.sim.tickRate;
    const now = this.now();
    if (now - this.lastTickAt > tickMs * 10) this.lastTickAt = now - tickMs; // stalled: don't spiral
    const snapshotEvery = Math.max(1, Math.round(this.cfg.sim.tickRate / this.cfg.net.snapshotRate));

    while (now - this.lastTickAt >= tickMs) {
      this.lastTickAt += tickMs;
      this.tick();
      if (++this.ticksSinceSnapshot >= snapshotEvery) {
        this.ticksSinceSnapshot = 0;
        this.broadcast(this.snapshot());
      }
    }
  }

  /** No one left at all: the registry can drop the room. */
  isEmpty(): boolean {
    return this.players.size === 0;
  }

  state(): RoomState {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        slot: p.slot,
        connected: p.conn !== null,
      })),
    };
  }

  /** Snapshot of the world for tests. */
  worldCopy(): World | null {
    return this.world ? cloneWorld(this.world) : null;
  }

  private tick(): void {
    const world = this.world!;
    const inputs: Inputs = {};
    for (const p of this.players.values()) {
      if (p.slot === null) continue;
      // One queued input per tick, like the client applied them. If the queue has backed
      // up (jitter, a backgrounded tab), merge the excess so latency doesn't build up.
      const due: TickInput[] = [];
      const first = p.queue.shift();
      if (first) due.push(first);
      while (p.queue.length > this.cfg.net.maxInputQueue) due.push(p.queue.shift()!);

      const input: PieceInput = { ...p.current };
      for (const { seq, input: next } of due) {
        if (next.target) p.current.target = input.target = next.target;
        if (next.targetAngle !== undefined) p.current.targetAngle = input.targetAngle = next.targetAngle;
        if (next.launch) input.launch = next.launch;
        p.ackSeq = seq;
      }
      inputs[p.slot] = input;
    }
    step(world, this.cfg, inputs);
  }

  private snapshot(): ServerMessage {
    const acks: Record<string, number> = {};
    for (const p of this.players.values()) {
      if (p.slot !== null && p.ackSeq >= 0) acks[p.slot] = p.ackSeq;
    }
    return { t: "snapshot", world: this.world!, acks };
  }

  private occupiedSlots(): ReturnType<typeof allSlots> {
    const taken = new Set([...this.players.values()].map((p) => p.slot));
    return allSlots(this.cfg).filter((s) => taken.has(s.id));
  }

  private vacate(p: Player): void {
    const info = p.slot === null ? undefined : slotInfo(this.cfg, p.slot);
    if (this.world && info?.kind === "blocker") removeBlocker(this.world, info.id);
    p.slot = null;
    p.current = {};
    p.queue = [];
  }

  private expireDisconnected(): void {
    const graceMs = this.cfg.room.reconnectGraceSeconds * 1000;
    let changed = false;
    for (const p of [...this.players.values()]) {
      if (p.disconnectedAt !== null && this.now() - p.disconnectedAt >= graceMs) {
        this.vacate(p);
        this.players.delete(p.id);
        changed = true;
      }
    }
    if (changed) {
      this.reassignHost();
      this.broadcastRoom();
    }
  }

  private reassignHost(): void {
    const host = this.hostId ? this.players.get(this.hostId) : undefined;
    if (host?.conn) return;
    const next = [...this.players.values()].find((p) => p.conn);
    this.hostId = next?.id ?? host?.id ?? null;
  }

  private broadcastRoom(): void {
    this.broadcast({ t: "room", room: this.state() });
  }

  private broadcast(msg: ServerMessage): void {
    for (const p of this.players.values()) p.conn?.send(msg);
  }
}

function cleanName(raw: string, max: number): string {
  const name = raw.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
  return name || "player";
}
