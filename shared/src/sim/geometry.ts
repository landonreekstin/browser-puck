import type { Config } from "../config";
import { add, clamp, dot, fromAngle, scale, sub, type Vec } from "../vec";
import type { Team } from "./world";

export interface Segment {
  a: Vec;
  b: Vec;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function closestPointOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 === 0) return a;
  const t = clamp(dot(sub(p, a), ab) / len2, 0, 1);
  return add(a, scale(ab, t));
}

/** Rink boundary: top, bottom, and each end wall split around its goal opening. */
export function rinkWalls(cfg: Config): Segment[] {
  const { width: w, height: h } = cfg.rink;
  const g0 = (h - cfg.goal.width) / 2;
  const g1 = (h + cfg.goal.width) / 2;
  const p = (x: number, y: number): Vec => ({ x, y });
  return [
    { a: p(0, 0), b: p(w, 0) },
    { a: p(0, h), b: p(w, h) },
    { a: p(0, 0), b: p(0, g0) },
    { a: p(0, g1), b: p(0, h) },
    { a: p(w, 0), b: p(w, g0) },
    { a: p(w, g1), b: p(w, h) },
  ];
}

export function goalieBox(cfg: Config, team: Team): Rect {
  const { width: w, height: h } = cfg.rink;
  const { depth, width } = cfg.goalieBox;
  const minY = (h - width) / 2;
  const maxY = (h + width) / 2;
  return team === 0
    ? { minX: 0, minY, maxX: depth, maxY }
    : { minX: w - depth, minY, maxX: w, maxY };
}

export function barSegment(pos: Vec, angle: number, len: number): Segment {
  const half = fromAngle(angle, len / 2);
  return { a: sub(pos, half), b: add(pos, half) };
}

/** Goalie centre stays inside its box (body fully inside). */
export function clampGoalieTarget(cfg: Config, team: Team, p: Vec): Vec {
  const box = goalieBox(cfg, team);
  const r = cfg.goalie.radius;
  return {
    x: clamp(p.x, box.minX + r, box.maxX - r),
    y: clamp(p.y, box.minY + r, box.maxY - r),
  };
}

/** Bar centre stays in its team's half and outside its goalie box. */
export function clampBlockerTarget(cfg: Config, team: Team, p: Vec): Vec {
  const { width: w, height: h } = cfg.rink;
  const m = cfg.bar.thickness / 2;
  const x = clamp(p.x, team === 0 ? m : w / 2, team === 0 ? w / 2 : w - m);
  const y = clamp(p.y, m, h - m);

  const box = goalieBox(cfg, team);
  const inside =
    x > box.minX - m && x < box.maxX + m && y > box.minY - m && y < box.maxY + m;
  if (!inside) return { x, y };

  // Push out through the nearest open side (the goal side is the wall).
  const candidates: Vec[] = [
    { x: team === 0 ? box.maxX + m : box.minX - m, y },
    { x, y: box.minY - m },
    { x, y: box.maxY + m },
  ];
  let best = candidates[0]!;
  for (const c of candidates) {
    if (Math.hypot(c.x - x, c.y - y) < Math.hypot(best.x - x, best.y - y)) best = c;
  }
  return best;
}
