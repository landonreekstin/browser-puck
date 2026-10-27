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
  /** Ticks the current goalie has held it (shot timer). */
  heldTicks: number;
  /** Consecutive ticks it has been dead (slow, outside the boxes). */
  deadTicks: number;
}

export interface World {
  tick: number;
  puck: Puck;
  goalies: Goalie[];
  blockers: Blocker[];
  score: [number, number];
  /** Set when a team reaches match.goalsToWin; the puck then stays frozen. */
  winner: Team | null;
}

/**
 * Starting layout: goalies centred in their boxes, `blockersPerTeam` bars spread across
 * each half, puck with the `kickoff` team's goalie.
 */
export function createWorld(cfg: Config, blockersPerTeam = cfg.sandbox.blockersPerTeam, kickoff: Team = 0): World {
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
    puck: newPuck({ x: w / 2, y: h / 2 }, null),
    goalies,
    blockers,
    score: [0, 0],
    winner: null,
  };
  givePuck(world, kickoff);
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
  world.puck = newPuck({ ...goalieOf(world, team).pos }, team);
}

function newPuck(pos: Vec, heldBy: Team | null): Puck {
  return { pos, vel: { x: 0, y: 0 }, heldBy, passThroughGoalie: null, heldTicks: 0, deadTicks: 0 };
}

export function cloneWorld(world: World): World {
  return JSON.parse(JSON.stringify(world)) as World;
}
