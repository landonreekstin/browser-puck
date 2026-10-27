import type { Config } from "../config";
import { length, type Vec } from "../vec";
import { goalieBox, type Rect } from "./geometry";
import { launchVelocity } from "./launch";
import { givePuck, type Team, type World } from "./world";

// Possession rules (DESIGN.md "Puck possession and flow"). Each knob at 0 switches its rule off.

export type Possession = { team: Team; reason: "catch" | "dead" };

/**
 * Shot timer for a held puck. Returns the team that auto-launched, if the timer ran out.
 * The auto-launch is a goalie launch: the one thing allowed to add energy (rule 4).
 */
export function shotTimer(world: World, cfg: Config): Team | null {
  const puck = world.puck;
  if (puck.heldBy === null) return null;
  puck.heldTicks++;
  const limit = cfg.rules.shotTimerSeconds * cfg.sim.tickRate;
  if (limit <= 0 || puck.heldTicks < limit) return null;

  const team = puck.heldBy;
  puck.vel = launchVelocity({ angle: team === 0 ? 0 : Math.PI, power: cfg.rules.autoLaunchPower }, cfg);
  puck.heldBy = null;
  puck.passThroughGoalie = team;
  puck.heldTicks = 0;
  return team;
}

/** Catch and dead-puck rules for a loose puck, applied after the tick's physics. */
export function possessionRules(world: World, cfg: Config): Possession | null {
  const puck = world.puck;
  if (puck.heldBy !== null) return null;
  const speed = length(puck.vel);

  for (const team of [0, 1] as const) {
    if (!inside(puck.pos, goalieBox(cfg, team))) continue;
    puck.deadTicks = 0;
    if (cfg.rules.catchSpeed > 0 && speed < cfg.rules.catchSpeed && puck.passThroughGoalie !== team) {
      givePuck(world, team);
      return { team, reason: "catch" };
    }
    return null;
  }

  puck.deadTicks = speed < cfg.rules.deadSpeed ? puck.deadTicks + 1 : 0;
  const limit = cfg.rules.deadPuckSeconds * cfg.sim.tickRate;
  if (limit > 0 && puck.deadTicks >= limit) {
    const team: Team = puck.pos.x < cfg.rink.width / 2 ? 0 : 1;
    givePuck(world, team);
    return { team, reason: "dead" };
  }
  return null;
}

function inside(p: Vec, r: Rect): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}
