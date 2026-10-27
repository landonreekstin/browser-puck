import type { Config } from "./config";
import type { TickInput } from "./protocol";
import { nextBlockerPose, nextGoaliePos, setBlockerTarget, setGoalieTarget, type PieceInput } from "./sim/step";
import type { Blocker, Goalie, World } from "./sim/world";
import { length, type Vec } from "./vec";

type Piece = ({ kind: "goalie" } & Goalie) | ({ kind: "blocker" } & Blocker);

/**
 * Client-side prediction for your own piece (ROADMAP M4).
 *
 * Every local tick applies that tick's input straight away (no input lag). When a
 * snapshot arrives, the prediction is rebuilt from the server's copy of the piece plus
 * the inputs the server hasn't applied yet (seq > ack), using the same motion code as
 * the sim. Pieces are kinematic, so with steady latency this matches the server
 * exactly. Any correction that does appear is blended out over a few frames.
 */
export class Predictor {
  private pending: TickInput[] = [];
  private piece: Piece | null = null;
  private error = { x: 0, y: 0, angle: 0 };
  /** Largest correction from the last reconcile (world units), for the debug overlay and tests. */
  lastCorrection = 0;

  constructor(private readonly cfg: Config) {}

  reset(): void {
    this.pending = [];
    this.piece = null;
    this.error = { x: 0, y: 0, angle: 0 };
  }

  /** One local sim tick with this input. */
  tick(entry: TickInput): void {
    this.pending.push(entry);
    if (this.pending.length > this.cfg.sim.tickRate * 4) this.pending.shift();
    if (this.piece) this.advance(this.piece, entry.input);
  }

  /** Rebase on the server's piece (`ack` = last input it applied) and replay the rest. */
  reconcile(world: World, pieceId: string, ack: number | undefined): void {
    const goalie = world.goalies.find((g) => g.id === pieceId);
    const blocker = world.blockers.find((b) => b.id === pieceId);
    const server: Piece | null = goalie
      ? { kind: "goalie", ...structuredCopy(goalie) }
      : blocker
        ? { kind: "blocker", ...structuredCopy(blocker) }
        : null;
    if (!server) {
      this.piece = null;
      return;
    }
    if (ack !== undefined) this.pending = this.pending.filter((e) => e.seq > ack);
    for (const e of this.pending) this.advance(server, e.input);

    const before = this.piece;
    this.piece = server;
    if (!before) return;
    const dx = before.pos.x - server.pos.x;
    const dy = before.pos.y - server.pos.y;
    const da = before.kind === "blocker" && server.kind === "blocker" ? before.angle - server.angle : 0;
    this.lastCorrection = Math.hypot(dx, dy);
    this.error.x += dx;
    this.error.y += dy;
    this.error.angle += da;
    // A big jump (respawn, slot change, long stall) isn't worth smoothing.
    if (length(this.error) > 150) this.error = { x: 0, y: 0, angle: 0 };
  }

  /** Fades the correction offset. */
  decay(elapsed: number): void {
    const k = Math.exp(-elapsed * 15);
    this.error.x *= k;
    this.error.y *= k;
    this.error.angle *= k;
  }

  /** Predicted pose to draw (with any correction still being blended out). */
  pose(): { pos: Vec; angle: number } | null {
    if (!this.piece) return null;
    return {
      pos: { x: this.piece.pos.x + this.error.x, y: this.piece.pos.y + this.error.y },
      angle: (this.piece.kind === "blocker" ? this.piece.angle : 0) + this.error.angle,
    };
  }

  /** Raw predicted pose (no smoothing), e.g. for input decisions. */
  rawAngle(): number | null {
    return this.piece?.kind === "blocker" ? this.piece.angle : null;
  }

  private advance(piece: Piece, input: PieceInput): void {
    const dt = 1 / this.cfg.sim.tickRate;
    if (piece.kind === "goalie") {
      setGoalieTarget(piece, this.cfg, input);
      piece.pos = nextGoaliePos(piece, this.cfg, dt);
    } else {
      setBlockerTarget(piece, this.cfg, input);
      const next = nextBlockerPose(piece, this.cfg, dt);
      piece.pos = next.pos;
      piece.angle = next.angle;
    }
  }
}

function structuredCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
