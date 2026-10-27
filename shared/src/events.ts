import type { StepEvents } from "./sim/step";
import type { Team } from "./sim/world";
import type { Vec } from "./vec";

/**
 * Things worth a sound or a flash, small enough to ride along with snapshots. The server
 * collects them per tick and the client plays them when it renders that tick.
 */
export type GameEvent =
  | { tick: number; type: "hit"; kind: "wall" | "bar" | "goalie"; point: Vec; impact: number; pieceId?: string }
  | { tick: number; type: "goal"; team: Team }
  | { tick: number; type: "launch"; team: Team; auto: boolean }
  | { tick: number; type: "possession"; team: Team; reason: "catch" | "dead" };

/** Impacts slower than this aren't worth an effect (a puck resting against a bar). */
const MIN_IMPACT = 30;

export function eventsFromStep(tick: number, e: StepEvents): GameEvent[] {
  const out: GameEvent[] = [];
  for (const c of e.contacts) {
    if (c.impact < MIN_IMPACT) continue;
    const hit: GameEvent = { tick, type: "hit", kind: c.kind, point: c.point, impact: Math.round(c.impact) };
    if (c.pieceId) hit.pieceId = c.pieceId;
    out.push(hit);
  }
  if (e.launched) out.push({ tick, type: "launch", team: e.launched.team, auto: e.launched.auto });
  if (e.goal) out.push({ tick, type: "goal", team: e.goal.scoringTeam });
  if (e.possession) out.push({ tick, type: "possession", ...e.possession });
  return out;
}
