import type { Config } from "../config";
import type { Vec } from "../vec";
import { goalieBox } from "./geometry";

export type Team = 0 | 1;

export interface Goalie {
  id: string;
  team: Team;
  pos: Vec;
  target: Vec;
}

export interface Blocker {
  id: string;
  team: Team;
  pos: Vec;
  angle: number;
  target: Vec;
  targetAngle: number;
}

export interface Puck {
  pos: Vec;
  vel: Vec;
  /** Team whose goalie is holding the puck, if any. */
  heldBy: Team | null;
  /** Just launched by this team's goalie: ignore that goalie until the puck is clear of it. */
  passThroughGoalie: Team | null;
}

export interface World {
  tick: number;
  puck: Puck;
  goalies: Goalie[];
  blockers: Blocker[];
  score: [number, number];
}

/**
 * Starting layout: goalies centred in their boxes, `blockersPerTeam` bars spread across
 * each half, puck with team 0.
 */
export function createWorld(cfg: Config, blockersPerTeam = cfg.sandbox.blockersPerTeam): World {
  const { width: w, height: h } = cfg.rink;
  const n = blockersPerTeam;
  const goalies: Goalie[] = [];
  const blockers: Blocker[] = [];

  for (const team of [0, 1] as const) {
    const box = goalieBox(cfg, team);
    const gp = { x: (box.minX + box.maxX) / 2, y: h / 2 };
    goalies.push({ id: `t${team}-goalie`, team, pos: gp, target: { ...gp } });
    for (let i = 0; i < n; i++) blockers.push(newBlocker(cfg, team, i, n));
  }

  const world: World = {
    tick: 0,
    puck: { pos: { x: w / 2, y: h / 2 }, vel: { x: 0, y: 0 }, heldBy: null, passThroughGoalie: null },
    goalies,
    blockers,
    score: [0, 0],
  };
  givePuck(world, 0);
  return world;
}

/** A bar at its home position: slot `index` of `count`, spread across the team's half. */
function newBlocker(cfg: Config, team: Team, index: number, count: number): Blocker {
  const { width: w, height: h } = cfg.rink;
  const pos = { x: team === 0 ? w * 0.3 : w * 0.7, y: (h * (index + 1)) / (count + 1) };
  return {
    id: `t${team}-b${index}`,
    team,
    pos,
    angle: Math.PI / 2,
    target: { ...pos },
    targetAngle: Math.PI / 2,
  };
}

/** Adds the bar for a blocker slot (drop-in), laid out over `room.maxBlockersPerTeam` slots. */
export function addBlocker(world: World, cfg: Config, team: Team, index: number): void {
  const bar = newBlocker(cfg, team, index, cfg.room.maxBlockersPerTeam);
  if (!world.blockers.some((b) => b.id === bar.id)) world.blockers.push(bar);
}

export function removeBlocker(world: World, id: string): void {
  world.blockers = world.blockers.filter((b) => b.id !== id);
}

export function goalieOf(world: World, team: Team): Goalie {
  const g = world.goalies.find((g) => g.team === team);
  if (!g) throw new Error(`no goalie for team ${team}`);
  return g;
}

export function givePuck(world: World, team: Team): void {
  const g = goalieOf(world, team);
  world.puck = { pos: { ...g.pos }, vel: { x: 0, y: 0 }, heldBy: team, passThroughGoalie: null };
}

export function cloneWorld(world: World): World {
  return JSON.parse(JSON.stringify(world)) as World;
}
