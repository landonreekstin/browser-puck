import { cloneWorld, step, type Config, type World } from "@puck/shared";
import { interpolate } from "./render";

/**
 * Server snapshots, rendered `net.interpDelayMs` in the past and interpolated between the
 * two snapshots around that time. A local clock estimates the current server tick: it runs
 * at real time and is nudged toward the newest snapshot's tick.
 *
 * If snapshots stop arriving (loss, a stall), the shared sim is run forward from the
 * newest one for up to `net.maxExtrapolateMs`, so the puck keeps moving and bouncing
 * instead of freezing (ROADMAP M4).
 */
export class SnapshotBuffer {
  private snaps: World[] = [];
  private clock: number | null = null;
  /** extrapolated[i] = newest snapshot advanced i ticks (index 0 is the snapshot itself). */
  private extrapolated: World[] = [];
  /** For the debug overlay: ticks we're currently extrapolating past the newest snapshot. */
  extrapolatingTicks = 0;

  constructor(private readonly cfg: Config) {}

  push(world: World): void {
    const last = this.latest();
    if (last && world.tick <= last.tick) {
      if (world.tick < last.tick - this.cfg.sim.tickRate) this.reset(); // a new match restarted the tick
      else return;
    }
    this.snaps.push(world);
    this.extrapolated = [];
    if (this.snaps.length > 60) this.snaps.shift();
  }

  reset(): void {
    this.snaps = [];
    this.extrapolated = [];
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
    this.extrapolatingTicks = 0;
    if (renderTick <= first.tick) return first;
    if (renderTick >= latest.tick) return this.extrapolate(latest, renderTick - latest.tick);

    let i = this.snaps.findIndex((s) => s.tick > renderTick);
    if (i <= 0) i = 1;
    return blend(this.snaps[i - 1]!, this.snaps[i]!, (renderTick - this.snaps[i - 1]!.tick) / (this.snaps[i]!.tick - this.snaps[i - 1]!.tick));
  }

  private extrapolate(latest: World, ahead: number): World {
    const maxTicks = Math.floor((this.cfg.net.maxExtrapolateMs / 1000) * this.cfg.sim.tickRate);
    const k = Math.min(ahead, maxTicks);
    this.extrapolatingTicks = k;
    if (this.extrapolated.length === 0) this.extrapolated.push(latest);
    while (this.extrapolated.length <= Math.ceil(k)) {
      const next = cloneWorld(this.extrapolated.at(-1)!);
      step(next, this.cfg, {});
      this.extrapolated.push(next);
    }
    const lo = Math.floor(k);
    return blend(this.extrapolated[lo]!, this.extrapolated[Math.ceil(k)]!, k - lo);
  }
}

function blend(a: World, b: World, alpha: number): World {
  const world = interpolate(a, b, alpha);
  // After a goal the puck teleports to a goalie: don't slide it across the rink.
  if (a.score[0] !== b.score[0] || a.score[1] !== b.score[1] || (a.puck.heldBy === null) !== (b.puck.heldBy === null)) {
    world.puck = alpha < 0.5 ? a.puck : b.puck;
  }
  return world;
}
