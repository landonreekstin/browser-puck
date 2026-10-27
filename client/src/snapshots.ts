import type { Config, World } from "@puck/shared";
import { interpolate } from "./render";

/**
 * Server snapshots, rendered `net.interpDelayMs` in the past and interpolated between the
 * two snapshots around that time. A local clock estimates the current server tick: it runs
 * at real time and is nudged toward the newest snapshot's tick.
 */
export class SnapshotBuffer {
  private snaps: World[] = [];
  private clock: number | null = null;

  constructor(private readonly cfg: Config) {}

  push(world: World): void {
    const last = this.latest();
    if (last && world.tick <= last.tick) {
      if (world.tick < last.tick - this.cfg.sim.tickRate) this.reset(); // a new match restarted the tick
      else return;
    }
    this.snaps.push(world);
    if (this.snaps.length > 60) this.snaps.shift();
  }

  reset(): void {
    this.snaps = [];
    this.clock = null;
  }

  latest(): World | undefined {
    return this.snaps.at(-1);
  }

  /** Advances the clock by `elapsed` seconds and returns the world to draw. */
  sample(elapsed: number): World | undefined {
    const latest = this.latest();
    if (!latest) return undefined;
    const rate = this.cfg.sim.tickRate;

    if (this.clock === null || Math.abs(this.clock - latest.tick) > rate) this.clock = latest.tick;
    else {
      this.clock += elapsed * rate;
      this.clock += (latest.tick - this.clock) * 0.05;
    }

    const renderTick = this.clock - (this.cfg.net.interpDelayMs / 1000) * rate;
    const first = this.snaps[0]!;
    if (renderTick <= first.tick) return first;
    if (renderTick >= latest.tick) return latest;

    let i = this.snaps.findIndex((s) => s.tick > renderTick);
    if (i <= 0) i = 1;
    const a = this.snaps[i - 1]!;
    const b = this.snaps[i]!;
    const alpha = (renderTick - a.tick) / (b.tick - a.tick);
    const world = interpolate(a, b, alpha);
    // After a goal the puck teleports to a goalie: don't slide it across the rink.
    if (a.score[0] !== b.score[0] || a.score[1] !== b.score[1] || (a.puck.heldBy === null) !== (b.puck.heldBy === null)) {
      world.puck = alpha < 0.5 ? a.puck : b.puck;
    }
    return world;
  }
}
