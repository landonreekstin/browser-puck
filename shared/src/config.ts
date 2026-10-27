// The single home for tuning numbers (CLAUDE.md rule 5). See docs/DESIGN.md "Tuning knobs".
// Units: world units (≈ CSS px at 1:1 zoom), seconds, radians.

export interface Config {
  net: {
    /** Game server port (dev and, by default, deployment). */
    port: number;
    /** How often the client sends a ping to measure RTT. */
    pingIntervalMs: number;
    /** Server → client world snapshots per second. */
    snapshotRate: number;
    /** Client → server input messages per second (at most; only sent when changed). */
    inputRate: number;
    /** How far behind the newest snapshot remote pieces are rendered. */
    interpDelayMs: number;
    /** Server-side per-player input queue; beyond this, queued inputs are merged (catch-up). */
    maxInputQueue: number;
    /** When snapshots stop arriving, the client runs the sim forward at most this long. */
    maxExtrapolateMs: number;
  };
  room: {
    maxBlockersPerTeam: number;
    /** A disconnected player keeps their slot this long. */
    reconnectGraceSeconds: number;
    nameMaxLength: number;
  };
  sim: {
    /** Fixed physics rate (Hz), independent of render and network rate. */
    tickRate: number;
    /** Max relative travel per substep, as a fraction of the puck radius (anti-tunneling). */
    substepTravel: number;
    /** Hard cap on substeps per tick. */
    maxSubsteps: number;
  };
  rink: { width: number; height: number; wallRestitution: number };
  goal: { width: number };
  goalieBox: { depth: number; width: number };
  puck: {
    radius: number;
    /** Exponential drag (1/s): speed is multiplied by exp(-drag·dt) each tick. */
    drag: number;
    /** Below this speed the puck stops dead. */
    stopSpeed: number;
  };
  goalie: { radius: number; moveSpeed: number; restitution: number };
  bar: {
    length: number;
    thickness: number;
    /** Clamped to ≤ 1 in code: bars never add energy (rule 4). */
    restitution: number;
    moveSpeed: number;
    rotateSpeed: number;
  };
  launch: {
    maxSpeed: number;
    /** Drag length (world units) that gives full power. */
    maxDrag: number;
    /** Shorter drags are cancelled. */
    minDrag: number;
    /** speed = maxSpeed · power^exponent (1 = linear). */
    powerExponent: number;
  };
  aimPreview: {
    /** Bounces drawn in the predicted path; 0 = up to first contact, -1 = no path. */
    bounces: number;
    /** Max predicted time (s). */
    seconds: number;
  };
  sandbox: { blockersPerTeam: number };
}

export const defaultConfig: Config = {
  net: { port: 8787, pingIntervalMs: 1000, snapshotRate: 30, inputRate: 30, interpDelayMs: 100, maxInputQueue: 4, maxExtrapolateMs: 250 },
  room: { maxBlockersPerTeam: 3, reconnectGraceSeconds: 120, nameMaxLength: 16 },
  sim: { tickRate: 60, substepTravel: 0.5, maxSubsteps: 64 },
  rink: { width: 1200, height: 600, wallRestitution: 0.9 },
  goal: { width: 160 },
  goalieBox: { depth: 110, width: 260 },
  puck: { radius: 16, drag: 0.35, stopSpeed: 5 },
  goalie: { radius: 26, moveSpeed: 500, restitution: 0.9 },
  bar: { length: 120, thickness: 12, restitution: 0.95, moveSpeed: 700, rotateSpeed: 7 },
  launch: { maxSpeed: 1600, maxDrag: 220, minDrag: 15, powerExponent: 1 },
  aimPreview: { bounces: 1, seconds: 1.5 },
  sandbox: { blockersPerTeam: 2 },
};

/** Deep copy, so callers can tweak a config without touching the defaults. */
export function cloneConfig(cfg: Config): Config {
  return JSON.parse(JSON.stringify(cfg)) as Config;
}
