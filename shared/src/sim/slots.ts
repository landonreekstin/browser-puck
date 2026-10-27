import type { Config } from "../config";
import type { Team } from "./world";

/** A lobby slot. Its id doubles as the piece id in the world: `t0-goalie`, `t1-b2`, … */
export type SlotId = string;

export interface SlotInfo {
  id: SlotId;
  team: Team;
  kind: "goalie" | "blocker";
  /** Blocker index within its team (0 for goalies). */
  index: number;
}

export function allSlots(cfg: Config): SlotInfo[] {
  return ([0, 1] as const).flatMap((team) => [
    { id: `t${team}-goalie`, team, kind: "goalie" as const, index: 0 },
    ...Array.from({ length: cfg.room.maxBlockersPerTeam }, (_, index) => ({
      id: `t${team}-b${index}`,
      team,
      kind: "blocker" as const,
      index,
    })),
  ]);
}

export function slotInfo(cfg: Config, id: SlotId): SlotInfo | undefined {
  return allSlots(cfg).find((s) => s.id === id);
}

/**
 * Why a match can't start with these slots filled, or null if it can: each team needs a
 * goalie and at least one blocker (DESIGN.md "Rooms and slots").
 */
export function startProblem(cfg: Config, taken: Iterable<SlotId | null>): string | null {
  const filled = new Set(taken);
  for (const team of [0, 1] as const) {
    const slots = allSlots(cfg).filter((s) => s.team === team && filled.has(s.id));
    if (!slots.some((s) => s.kind === "goalie")) return `team ${team + 1} needs a goalie`;
    if (!slots.some((s) => s.kind === "blocker")) return `team ${team + 1} needs a blocker`;
  }
  return null;
}
