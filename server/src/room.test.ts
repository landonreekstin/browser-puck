import { describe, expect, it } from "vitest";
import { createRng, defaultConfig, length, Predictor, type PieceInput, type ServerMessage, type TickInput } from "@puck/shared";
import { Room, type Conn } from "./room";

class FakeConn implements Conn {
  readonly sent: ServerMessage[] = [];
  send(msg: ServerMessage): void {
    // Copy, like a real socket serialising: the room keeps mutating its world afterwards.
    this.sent.push(JSON.parse(JSON.stringify(msg)) as ServerMessage);
  }
  last<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    return this.sent.filter((m) => m.t === t).at(-1) as Extract<ServerMessage, { t: T }> | undefined;
  }
}

let seq = 0;
const one = (input: PieceInput): TickInput[] => [{ seq: seq++, input }];

function setup() {
  let time = 0;
  // random → 0: team 0 kicks off, so tests know who holds the puck.
  const room = new Room("TEST", defaultConfig, () => time, () => 0);
  const advance = (ms: number): void => {
    // Step the clock in small increments like the real poll loop.
    const end = time + ms;
    while (time < end) {
      time = Math.min(time + 4, end);
      room.update();
    }
  };
  const join = (name: string, slot?: string) => {
    const conn = new FakeConn();
    const player = room.join(conn, name);
    if (slot) expect(room.pickSlot(player.id, slot)).toBeNull();
    return { conn, id: player.id, token: player.token };
  };
  return { room, advance, join };
}

function fullMinimum(s: ReturnType<typeof setup>) {
  return {
    a: s.join("a", "t0-goalie"),
    b: s.join("b", "t0-b0"),
    c: s.join("c", "t1-goalie"),
    d: s.join("d", "t1-b0"),
  };
}

describe("Room lobby", () => {
  it("welcomes players and makes the first one host", () => {
    const s = setup();
    const a = s.join("Ann");
    const b = s.join("Bob");
    expect(a.conn.last("welcome")?.playerId).toBe(a.id);
    expect(s.room.hostId).toBe(a.id);
    expect(b.conn.last("room")?.room.players.map((p) => p.name)).toEqual(["Ann", "Bob"]);
  });

  it("allows one player per slot, so one goalie per team", () => {
    const s = setup();
    const a = s.join("a", "t0-goalie");
    const b = s.join("b");
    expect(s.room.pickSlot(b.id, "t0-goalie")).toBe("slot taken");
    expect(s.room.pickSlot(b.id, "t9-goalie")).toBe("no such slot");
    expect(s.room.pickSlot(b.id, "t1-goalie")).toBeNull();
    expect(s.room.pickSlot(a.id, null)).toBeNull();
    expect(s.room.pickSlot(b.id, "t0-goalie")).toBeNull(); // moved: old slot frees
    expect(s.room.state().players.find((p) => p.id === b.id)?.slot).toBe("t0-goalie");
  });

  it("caps the room at 8 slotted players", () => {
    const s = setup();
    const slots = ["t0-goalie", "t0-b0", "t0-b1", "t0-b2", "t1-goalie", "t1-b0", "t1-b1", "t1-b2"];
    for (const slot of slots) s.join(slot, slot);
    const ninth = s.join("ninth");
    for (const slot of slots) expect(s.room.pickSlot(ninth.id, slot)).toBe("slot taken");
  });

  it("starts only for the host, with a goalie and a blocker on each team", () => {
    const s = setup();
    const a = s.join("a", "t0-goalie");
    const b = s.join("b", "t0-b0");
    const c = s.join("c", "t1-goalie");
    expect(s.room.start(a.id)).toBe("team 2 needs a blocker");
    const d = s.join("d", "t1-b2");
    expect(s.room.start(b.id)).toBe("only the host can start");
    expect(s.room.start(a.id)).toBeNull();
    expect(s.room.phase).toBe("playing");
    expect(s.room.worldCopy()!.blockers.map((x) => x.id).sort()).toEqual(["t0-b0", "t1-b2"]);
    void c;
    void d;
  });

  it("hands host to the next connected player when the host disconnects", () => {
    const s = setup();
    const a = s.join("a");
    const b = s.join("b");
    s.room.disconnect(a.id, a.conn);
    expect(s.room.hostId).toBe(b.id);
  });
});

describe("Room match", () => {
  it("runs the sim at the fixed rate and snapshots at the snapshot rate", () => {
    const s = setup();
    const { a } = fullMinimum(s);
    expect(s.room.start(a.id)).toBeNull();
    const before = a.conn.sent.filter((m) => m.t === "snapshot").length;
    s.advance(1000);
    const tick = s.room.worldCopy()!.tick;
    expect(tick).toBeGreaterThanOrEqual(59);
    expect(tick).toBeLessThanOrEqual(61);
    const snapshots = a.conn.sent.filter((m) => m.t === "snapshot").length - before;
    expect(snapshots).toBeGreaterThanOrEqual(29);
    expect(snapshots).toBeLessThanOrEqual(31);
  });

  it("applies a player's input only to their own piece", () => {
    const s = setup();
    const { a, b } = fullMinimum(s);
    s.room.start(a.id);
    const start = s.room.worldCopy()!;
    s.room.input(b.id, one({ target: { x: 200, y: 100 } }));
    s.room.input(a.id, one({ launch: { angle: 0, power: 1 } })); // a is goalie t0, holds the puck
    s.advance(500);
    const w = s.room.worldCopy()!;
    const bar = w.blockers.find((x) => x.id === "t0-b0")!;
    expect(bar.pos).toEqual({ x: 200, y: 100 });
    for (const other of w.blockers.filter((x) => x.id !== "t0-b0")) {
      expect(other.pos).toEqual(start.blockers.find((x) => x.id === other.id)!.pos);
    }
    expect(w.puck.heldBy).toBeNull();
    expect(length(w.puck.vel) > 0 || w.score[0] + w.score[1] > 0).toBe(true);
  });

  it("ignores a launch from a blocker", () => {
    const s = setup();
    const { a, b } = fullMinimum(s);
    s.room.start(a.id);
    s.room.input(b.id, one({ launch: { angle: 0, power: 1 } }));
    s.advance(200);
    expect(s.room.worldCopy()!.puck.heldBy).toBe(0);
  });

  it("drop-in: taking or leaving a blocker slot mid-match adds or removes the bar", () => {
    const s = setup();
    const { a, d } = fullMinimum(s);
    s.room.start(a.id);
    const late = s.join("late", "t1-b1");
    expect(s.room.worldCopy()!.blockers.some((x) => x.id === "t1-b1")).toBe(true);
    expect(late.conn.last("snapshot")).toBeDefined();
    s.room.pickSlot(d.id, null);
    expect(s.room.worldCopy()!.blockers.some((x) => x.id === "t1-b0")).toBe(false);
  });

  it("keeps a disconnected player's slot for the grace period and restores it by token", () => {
    const s = setup();
    const { a, c } = fullMinimum(s);
    s.room.start(a.id);
    s.room.disconnect(c.id, c.conn);
    s.advance(5000);
    expect(s.room.state().players.find((p) => p.id === c.id)).toMatchObject({ slot: "t1-goalie", connected: false });

    const conn = new FakeConn();
    const again = s.room.join(conn, "c", c.token);
    expect(again.id).toBe(c.id);
    expect(again.slot).toBe("t1-goalie");
    expect(conn.last("welcome")?.playerId).toBe(c.id);
    expect(s.room.state().players.find((p) => p.id === c.id)?.connected).toBe(true);
  });

  it("frees the slot after the grace period", () => {
    const s = setup();
    const { a, d } = fullMinimum(s);
    s.room.start(a.id);
    s.room.disconnect(d.id, d.conn);
    s.advance(defaultConfig.room.reconnectGraceSeconds * 1000 + 100);
    expect(s.room.state().players.some((p) => p.id === d.id)).toBe(false);
    expect(s.room.worldCopy()!.blockers.some((x) => x.id === "t1-b0")).toBe(false);
    const e = s.join("e");
    expect(s.room.pickSlot(e.id, "t1-b0")).toBeNull();
  });

  it("a stale socket closing doesn't disconnect the player's newer connection", () => {
    const s = setup();
    const a = s.join("a");
    const newer = new FakeConn();
    s.room.join(newer, "a", a.token);
    s.room.disconnect(a.id, a.conn);
    expect(s.room.state().players[0]?.connected).toBe(true);
  });

  it("host can end the match, back to the lobby", () => {
    const s = setup();
    const { a } = fullMinimum(s);
    s.room.start(a.id);
    expect(s.room.stop(a.id)).toBeNull();
    expect(s.room.phase).toBe("lobby");
    expect(s.room.worldCopy()).toBeNull();
  });
});

describe("Room input queue (M4)", () => {
  it("applies one queued input per tick and acks it in snapshots", () => {
    const s = setup();
    const { a, b } = fullMinimum(s);
    s.room.start(a.id);
    s.room.input(b.id, [
      { seq: 0, input: { target: { x: 300, y: 100 } } },
      { seq: 1, input: { target: { x: 300, y: 110 } } },
      { seq: 2, input: { target: { x: 300, y: 120 } } },
    ]);
    s.room.input(b.id, [{ seq: 1, input: { target: { x: 0, y: 0 } } }]); // duplicate: dropped
    s.advance(1000);
    const snap = b.conn.last("snapshot")!;
    expect(snap.acks["t0-b0"]).toBe(2);
    expect(snap.world.blockers.find((x) => x.id === "t0-b0")!.target).toEqual({ x: 300, y: 120 });
  });

  it("merges a backed-up queue without losing a shot", () => {
    const s = setup();
    const { a } = fullMinimum(s);
    s.room.start(a.id);
    const burst = Array.from({ length: 12 }, (_, i) => ({ seq: i, input: { target: { x: 50, y: 300 } } as PieceInput }));
    burst[3]!.input.launch = { angle: 0, power: 1 };
    s.room.input(a.id, burst);
    s.advance(20); // ~1 tick: consumes 1 + merges down to maxInputQueue
    expect(s.room.worldCopy()!.puck.heldBy).toBeNull();
    s.advance(200);
    expect(a.conn.last("snapshot")!.acks["t0-goalie"]).toBe(11);
  });

  it("a rejoining client can restart its seq counter", () => {
    const s = setup();
    const { a, b } = fullMinimum(s);
    s.room.start(a.id);
    s.room.input(b.id, [{ seq: 500, input: { target: { x: 300, y: 100 } } }]);
    s.advance(100);
    s.room.join(new FakeConn(), "b", b.token);
    s.room.input(b.id, [{ seq: 0, input: { target: { x: 300, y: 500 } } }]);
    s.advance(1000);
    expect(s.room.worldCopy()!.blockers.find((x) => x.id === "t0-b0")!.pos).toEqual({ x: 300, y: 500 });
  });
});

describe("client prediction against the real server room", () => {
  /** Lockstep client/server ticks with fixed or jittery one-way delays (in ticks). */
  function runPrediction(delayTicks: (rand: () => number) => number, seed: number) {
    const s = setup();
    const { a, b } = fullMinimum(s);
    s.room.start(a.id);
    const predictor = new Predictor(defaultConfig);
    const rand = createRng(seed);
    const toServer: { at: number; inputs: TickInput[] }[] = [];
    const toClient: { at: number; msg: Extract<ServerMessage, { t: "snapshot" }> }[] = [];
    let seen = b.conn.sent.length;
    let clientSeq = 0;
    let maxCorrection = 0;
    let lastSendAt = -1;

    for (let t = 0; t < 600; t++) {
      // Client: a target that sweeps faster than the bar can follow (so timing errors would
      // show), one input per tick.
      const input: PieceInput = {
        target: { x: 300 + 200 * Math.sin(t / 5), y: 300 + 200 * Math.cos(t / 7) },
        targetAngle: Math.sin(t / 4) * 3,
      };
      const entry = { seq: clientSeq++, input };
      predictor.tick(entry);
      const sendAt = Math.max(lastSendAt, t + delayTicks(rand)); // TCP: in order
      lastSendAt = sendAt;
      toServer.push({ at: sendAt, inputs: [entry] });

      // Network delivery.
      while (toServer[0] && toServer[0].at <= t) s.room.input(b.id, toServer.shift()!.inputs);
      s.advance(1000 / 60);
      for (const msg of b.conn.sent.slice(seen)) {
        if (msg.t === "snapshot") toClient.push({ at: t + delayTicks(rand), msg });
      }
      seen = b.conn.sent.length;
      toClient.sort((x, y) => x.at - y.at);
      while (toClient[0] && toClient[0].at <= t) {
        const { msg } = toClient.shift()!;
        predictor.reconcile(msg.world, "t0-b0", msg.acks["t0-b0"]);
        if (t > 60) maxCorrection = Math.max(maxCorrection, predictor.lastCorrection);
      }
    }
    return maxCorrection;
  }

  it("matches the server exactly under steady latency", () => {
    expect(runPrediction(() => 6, 1)).toBeLessThan(1e-6);
  });

  it("stays within a tick or two of motion under jitter", () => {
    // ROADMAP's 100 ms ± 30 ms RTT: 50 ± 15 ms ≈ 3 ± 1 ticks each way.
    const max = runPrediction((r) => 2 + Math.floor(r() * 3), 2);
    expect(max).toBeGreaterThan(0); // jitter really does perturb it…
    expect(max).toBeLessThan((2 * defaultConfig.bar.moveSpeed) / defaultConfig.sim.tickRate); // …by ≤ 2 ticks
  });
});

describe("Room kickoff", () => {
  it("gives the first kickoff to a random team", () => {
    for (const [roll, team] of [[0.1, 0], [0.9, 1]] as const) {
      const room = new Room("TEST", defaultConfig, () => 0, () => roll);
      const ids = ["t0-goalie", "t0-b0", "t1-goalie", "t1-b0"].map((slot) => {
        const p = room.join(new FakeConn(), slot);
        room.pickSlot(p.id, slot);
        return p.id;
      });
      expect(room.start(ids[0]!)).toBeNull();
      expect(room.worldCopy()!.puck.heldBy).toBe(team);
    }
  });
});
