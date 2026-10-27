import type { Config } from "../config";
import { add, distance, lerp, length, scale, sub, type Vec } from "../vec";
import { collideCapsule, type Hit } from "./collide";
import { barSegment, clampBlockerTarget, clampGoalieTarget, rinkWalls } from "./geometry";
import { launchVelocity, type Launch } from "./launch";
import { givePuck, goalieOf, type Team, type World } from "./world";

/** What a player controls. Targets persist in the world until the next input changes them. */
export interface PieceInput {
  target?: Vec;
  targetAngle?: number;
  /** Goalie only; ignored unless that goalie holds the puck. */
  launch?: Launch;
}

/** Inputs for this tick, keyed by piece id. */
export type Inputs = Record<string, PieceInput>;

export interface Contact {
  kind: "wall" | "bar" | "goalie";
  point: Vec;
  normal: Vec;
  /** Puck centre at the moment of contact. */
  puckPos: Vec;
}

export interface StepEvents {
  contacts: Contact[];
  goal: { scoringTeam: Team; at: Vec } | null;
  substeps: number;
}

interface Pose {
  pos: Vec;
  angle: number;
}

/** Advances the world one fixed tick (1 / sim.tickRate). Mutates `world` in place. */
export function step(world: World, cfg: Config, inputs: Inputs): StepEvents {
  const dt = 1 / cfg.sim.tickRate;
  const puck = world.puck;
  const events: StepEvents = { contacts: [], goal: null, substeps: 0 };

  applyInputs(world, cfg, inputs);

  // Where each piece starts and ends this tick; the puck sees them interpolated per substep.
  const goalieFrom: Pose[] = world.goalies.map((g) => ({ pos: g.pos, angle: 0 }));
  const goalieTo: Pose[] = world.goalies.map((g) => ({
    pos: moveToward(g.pos, g.target, cfg.goalie.moveSpeed * dt),
    angle: 0,
  }));
  const barFrom: Pose[] = world.blockers.map((b) => ({ pos: b.pos, angle: b.angle }));
  const barTo: Pose[] = world.blockers.map((b) => ({
    pos: moveToward(b.pos, b.target, cfg.bar.moveSpeed * dt),
    angle: b.angle + clampAbs(angleDiff(b.angle, b.targetAngle), cfg.bar.rotateSpeed * dt),
  }));

  const setPoses = (t: number): void => {
    world.goalies.forEach((g, i) => {
      g.pos = lerp(goalieFrom[i]!.pos, goalieTo[i]!.pos, t);
    });
    world.blockers.forEach((b, i) => {
      const from = barFrom[i]!;
      const to = barTo[i]!;
      b.pos = lerp(from.pos, to.pos, t);
      b.angle = from.angle + (to.angle - from.angle) * t;
    });
  };

  if (puck.heldBy !== null) {
    setPoses(1);
    puck.pos = { ...goalieOf(world, puck.heldBy).pos };
    puck.vel = { x: 0, y: 0 };
    world.tick++;
    return events;
  }

  // Substeps so neither the puck nor any piece moves more than a fraction of the puck
  // radius between collision checks (anti-tunneling).
  let pieceTravel = 0;
  goalieFrom.forEach((f, i) => {
    pieceTravel = Math.max(pieceTravel, distance(f.pos, goalieTo[i]!.pos));
  });
  barFrom.forEach((f, i) => {
    const to = barTo[i]!;
    const tipTravel = (Math.abs(to.angle - f.angle) * cfg.bar.length) / 2;
    pieceTravel = Math.max(pieceTravel, distance(f.pos, to.pos) + tipTravel);
  });
  const travel = length(puck.vel) * dt + pieceTravel;
  const n = Math.min(
    Math.max(1, Math.ceil(travel / (cfg.puck.radius * cfg.sim.substepTravel))),
    cfg.sim.maxSubsteps,
  );
  events.substeps = n;

  const walls = rinkWalls(cfg);
  for (let s = 1; s <= n; s++) {
    setPoses(s / n);
    puck.pos = add(puck.pos, scale(puck.vel, dt / n));
    resolveCollisions(world, cfg, walls, events.contacts);

    const scoringTeam = goalScoredBy(world, cfg);
    if (scoringTeam !== null) {
      events.goal = { scoringTeam, at: { ...puck.pos } };
      world.score[scoringTeam]++;
      setPoses(1);
      // Provisional faceoff (DESIGN.md "Puck possession"): conceding goalie gets the puck.
      givePuck(world, scoringTeam === 0 ? 1 : 0);
      world.tick++;
      return events;
    }
  }

  // Drag only ever removes speed.
  world.puck.vel = scale(puck.vel, Math.exp(-cfg.puck.drag * dt));
  if (length(world.puck.vel) < cfg.puck.stopSpeed) world.puck.vel = { x: 0, y: 0 };

  world.tick++;
  return events;
}

function applyInputs(world: World, cfg: Config, inputs: Inputs): void {
  for (const g of world.goalies) {
    const input = inputs[g.id];
    if (!input) continue;
    if (input.target && isFiniteVec(input.target)) {
      g.target = clampGoalieTarget(cfg, g.team, input.target);
    }
    if (input.launch && world.puck.heldBy === g.team) {
      world.puck.vel = launchVelocity(input.launch, cfg);
      world.puck.heldBy = null;
      world.puck.passThroughGoalie = g.team;
    }
  }
  for (const b of world.blockers) {
    const input = inputs[b.id];
    if (!input) continue;
    if (input.target && isFiniteVec(input.target)) {
      b.target = clampBlockerTarget(cfg, b.team, input.target);
    }
    if (input.targetAngle !== undefined && Number.isFinite(input.targetAngle)) {
      b.targetAngle = input.targetAngle;
    }
  }
}

function resolveCollisions(
  world: World,
  cfg: Config,
  walls: { a: Vec; b: Vec }[],
  contacts: Contact[],
): void {
  const puck = world.puck;
  const r = cfg.puck.radius;
  const record = (kind: Contact["kind"], hit: Hit | null): void => {
    if (hit?.bounced) contacts.push({ kind, point: hit.point, normal: hit.normal, puckPos: { ...puck.pos } });
  };

  // A few passes so corners (bar against wall, post) settle. Walls go last so the puck
  // always ends inside the rink.
  for (let iter = 0; iter < 3; iter++) {
    for (const b of world.blockers) {
      const seg = barSegment(b.pos, b.angle, cfg.bar.length);
      record("bar", collideCapsule(puck, r, seg.a, seg.b, cfg.bar.thickness / 2, cfg.bar.restitution));
    }
    for (const g of world.goalies) {
      if (puck.passThroughGoalie === g.team) {
        if (distance(puck.pos, g.pos) < r + cfg.goalie.radius) continue;
        puck.passThroughGoalie = null;
      }
      record("goalie", collideCapsule(puck, r, g.pos, g.pos, cfg.goalie.radius, cfg.goalie.restitution));
    }
    for (const w of walls) {
      record("wall", collideCapsule(puck, r, w.a, w.b, 0, cfg.rink.wallRestitution));
    }
  }
}

/** A goal is the puck fully across a goal line (DESIGN.md "Scoring"). */
function goalScoredBy(world: World, cfg: Config): Team | null {
  const { x } = world.puck.pos;
  const r = cfg.puck.radius;
  if (x < -r) return 1;
  if (x > cfg.rink.width + r) return 0;
  return null;
}

function moveToward(from: Vec, to: Vec, maxDist: number): Vec {
  const d = sub(to, from);
  const len = length(d);
  return len <= maxDist ? { ...to } : add(from, scale(d, maxDist / len));
}

/** Signed shortest rotation from a to b, in (-π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

function clampAbs(v: number, max: number): number {
  return Math.max(-max, Math.min(max, v));
}

function isFiniteVec(v: Vec): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y);
}
