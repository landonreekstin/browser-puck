// Headless bot players for load and regression testing (ROADMAP M2).
//   npm run bot -- --room ABCD --count 6       fill free slots in an existing room
//   npm run bot -- --create --count 8 --start  make a room, fill it, start the match
// Bots take free slots (blockers first unless --goalies), wander and rotate at random,
// and goalies shoot roughly at the other goal after a short random hold.
import { parseArgs } from "node:util";
import WebSocket from "ws";
import {
  allSlots,
  clampBlockerTarget,
  clampGoalieTarget,
  createRng,
  decodeServerMessage,
  defaultConfig as cfg,
  encode,
  slotInfo,
  type ClientMessage,
  type RoomState,
  type World,
} from "@puck/shared";

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: `ws://localhost:${cfg.net.port}` },
    room: { type: "string" },
    create: { type: "boolean", default: false },
    count: { type: "string", default: "1" },
    start: { type: "boolean", default: false },
    goalies: { type: "boolean", default: false },
    seed: { type: "string", default: String(Date.now() % 100000) },
    seconds: { type: "string", default: "0" },
  },
});

const count = Number(args.count);
const rand = createRng(Number(args.seed));
const range = (min: number, max: number): number => min + rand() * (max - min);

class Bot {
  private ws: WebSocket;
  private room: RoomState | null = null;
  private world: World | null = null;
  private playerId: string | null = null;
  private heldSince: number | null = null;
  private shootAfterMs = 0;
  private nextMoveAt = 0;

  constructor(
    readonly name: string,
    private readonly code: string | null,
    private readonly onRoom: (code: string) => void,
  ) {
    this.ws = new WebSocket(args.url);
    this.ws.on("open", () => this.send({ t: "join", room: code, name }));
    this.ws.on("message", (data) => this.onMessage(data.toString()));
    this.ws.on("error", (err) => console.error(`${name}: ${err.message}`));
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  close(): void {
    this.ws.close();
  }

  get slot(): string | null {
    return this.room?.players.find((p) => p.id === this.playerId)?.slot ?? null;
  }

  isHost(): boolean {
    return this.room?.hostId === this.playerId;
  }

  roomState(): RoomState | null {
    return this.room;
  }

  private onMessage(raw: string): void {
    const msg = decodeServerMessage(raw);
    if (!msg) return;
    if (msg.t === "welcome") {
      this.playerId = msg.playerId;
      this.onRoom(msg.room);
    } else if (msg.t === "room") {
      this.room = msg.room;
      if (!this.slot) this.claimSlot();
    } else if (msg.t === "snapshot") {
      this.world = msg.world;
    } else if (msg.t === "error" && msg.message !== "slot taken") {
      console.error(`${this.name}: ${msg.message}`);
    }
  }

  /** Take the first free slot (others may race us; the server's "slot taken" sorts it). */
  private claimSlot(): void {
    const taken = new Set(this.room!.players.map((p) => p.slot));
    const free = allSlots(cfg).filter((s) => !taken.has(s.id));
    // Preferred kind first, then the team with fewer players.
    const teamSize = (t: number) => this.room!.players.filter((p) => p.slot?.startsWith(`t${t}`)).length;
    const kindRank = (k: string) => ((k === "goalie") === args.goalies ? 0 : 1);
    free.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || teamSize(a.team) - teamSize(b.team));
    const pick = free[0];
    if (pick) this.send({ t: "pickSlot", slot: pick.id });
  }

  /** Called ~30×/s. */
  think(now: number): void {
    const slot = this.slot;
    const world = this.world;
    if (!slot || !world || this.room?.phase !== "playing") return;
    const info = slotInfo(cfg, slot)!;
    const { width: w, height: h } = cfg.rink;

    if (info.kind === "goalie") {
      const holding = world.puck.heldBy === info.team;
      if (holding && this.heldSince === null) {
        this.heldSince = now;
        this.shootAfterMs = range(400, 1800);
      }
      if (!holding) this.heldSince = null;
      if (holding && now - this.heldSince! > this.shootAfterMs) {
        const towardGoal = info.team === 0 ? 0 : Math.PI;
        this.send({ t: "input", input: { launch: { angle: towardGoal + range(-0.9, 0.9), power: range(0.5, 1) } } });
        this.heldSince = null;
        return;
      }
      if (now >= this.nextMoveAt) {
        this.nextMoveAt = now + range(300, 1200);
        const target = clampGoalieTarget(cfg, info.team, { x: range(0, w), y: range(0, h) });
        this.send({ t: "input", input: { target } });
      }
      return;
    }

    if (now >= this.nextMoveAt) {
      this.nextMoveAt = now + range(500, 2000);
      const x = info.team === 0 ? range(0, w / 2) : range(w / 2, w);
      const target = clampBlockerTarget(cfg, info.team, { x, y: range(0, h) });
      this.send({ t: "input", input: { target, targetAngle: range(-Math.PI, Math.PI) } });
    }
  }
}

const bots: Bot[] = [];
let code = args.room?.toUpperCase() ?? null;
if (!code && !args.create) {
  console.error("pass --room CODE or --create");
  process.exit(2);
}

function spawnRest(): void {
  for (let i = bots.length; i < count; i++) bots.push(new Bot(`bot${i + 1}`, code, () => {}));
}

if (code) spawnRest();
else {
  bots.push(
    new Bot("bot1", null, (c) => {
      if (code) return;
      code = c;
      console.log(`room ${code}`);
      spawnRest();
    }),
  );
}

let started = false;
const timer = setInterval(() => {
  const now = Date.now();
  for (const bot of bots) bot.think(now);
  const host = bots.find((b) => b.isHost());
  const state = host?.roomState();
  if (args.start && !started && host && state?.phase === "lobby" && bots.every((b) => b.slot)) {
    started = true;
    host.send({ t: "start" });
    console.log("started");
  }
}, 33);

const stop = (): void => {
  clearInterval(timer);
  for (const bot of bots) bot.close();
  setTimeout(() => process.exit(0), 100);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
if (Number(args.seconds) > 0) setTimeout(stop, Number(args.seconds) * 1000);
