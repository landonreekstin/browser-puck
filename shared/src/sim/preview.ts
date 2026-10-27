import type { Config } from "../config";
import type { Vec } from "../vec";
import type { Launch } from "./launch";
import { step, type Inputs } from "./step";
import { cloneWorld, goalieOf, type Team, type World } from "./world";

/**
 * Predicted puck path for the aim preview (DESIGN.md "Goalie"). Every other piece is
 * frozen in place; the path runs through `aimPreview.bounces` bounces.
 */
export function predictPath(world: World, cfg: Config, team: Team, launch: Launch): Vec[] {
  const bounces = cfg.aimPreview.bounces;
  if (bounces < 0 || world.puck.heldBy !== team) return [];

  const w = cloneWorld(world);
  for (const g of w.goalies) g.target = { ...g.pos };
  for (const b of w.blockers) {
    b.target = { ...b.pos };
    b.targetAngle = b.angle;
  }

  const points: Vec[] = [{ ...w.puck.pos }];
  const maxTicks = Math.ceil(cfg.aimPreview.seconds * cfg.sim.tickRate);
  let contacts = 0;
  let inputs: Inputs = { [goalieOf(w, team).id]: { launch } };

  for (let i = 0; i < maxTicks; i++) {
    const events = step(w, cfg, inputs);
    inputs = {};
    for (const c of events.contacts) {
      points.push(c.puckPos);
      if (++contacts > bounces) return points;
    }
    if (events.goal) {
      points.push(events.goal.at);
      return points;
    }
    points.push({ ...w.puck.pos });
    if (w.puck.vel.x === 0 && w.puck.vel.y === 0) break;
  }
  return points;
}
