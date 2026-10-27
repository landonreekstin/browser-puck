import type { Config } from "../config";
import { clamp, fromAngle, length, type Vec } from "../vec";

/** A goalie's shot: direction plus power in [0, 1]. */
export interface Launch {
  angle: number;
  power: number;
}

/**
 * Slingshot mapping. `pull` is the drag vector (current pointer − press point); the shot
 * goes the opposite way. Returns null for drags shorter than `launch.minDrag` (cancel).
 */
export function launchFromDrag(pull: Vec, cfg: Config): Launch | null {
  const len = length(pull);
  if (len < cfg.launch.minDrag) return null;
  return { angle: Math.atan2(-pull.y, -pull.x), power: Math.min(len / cfg.launch.maxDrag, 1) };
}

export function launchVelocity(launch: Launch, cfg: Config): Vec {
  if (!Number.isFinite(launch.angle) || !Number.isFinite(launch.power)) return { x: 0, y: 0 };
  const power = clamp(launch.power, 0, 1);
  return fromAngle(launch.angle, cfg.launch.maxSpeed * power ** cfg.launch.powerExponent);
}
