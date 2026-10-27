import { add, clamp, dot, length, scale, sub, type Vec } from "../vec";
import { closestPointOnSegment } from "./geometry";

export interface Body {
  pos: Vec;
  vel: Vec;
}

export interface Hit {
  point: Vec;
  normal: Vec;
  /** True if the puck was moving into the obstacle and got reflected. */
  bounced: boolean;
}

/**
 * Circle (radius `r`) vs capsule (segment a–b, radius `capR`). Walls are capsules with
 * radius 0, goalies are capsules with a === b.
 *
 * Pushes the body out and reflects the normal component of its velocity. The obstacle's
 * own motion is ignored and restitution is clamped to [0, 1], so the outgoing speed is
 * never higher than the incoming one (rule 4):
 *   |v'|² = |v_t|² + e²·v_n² ≤ |v|².
 */
export function collideCapsule(
  body: Body,
  r: number,
  a: Vec,
  b: Vec,
  capR: number,
  restitution: number,
): Hit | null {
  const point = closestPointOnSegment(body.pos, a, b);
  const d = sub(body.pos, point);
  const dist = length(d);
  const minDist = r + capR;
  if (dist >= minDist) return null;

  const normal = dist > 1e-9 ? scale(d, 1 / dist) : fallbackNormal(a, b);
  body.pos = add(point, scale(normal, minDist));

  const vn = dot(body.vel, normal);
  if (vn >= 0) return { point, normal, bounced: false };

  const e = clamp(restitution, 0, 1);
  body.vel = sub(body.vel, scale(normal, (1 + e) * vn));
  return { point, normal, bounced: true };
}

function fallbackNormal(a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const len = length(ab);
  return len > 0 ? { x: -ab.y / len, y: ab.x / len } : { x: 0, y: -1 };
}
