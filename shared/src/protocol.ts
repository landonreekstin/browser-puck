// Wire messages between client and server (JSON). Clients send intents and inputs only —
// never positions or puck state (CLAUDE.md rule 1). Everything a client sends is validated.

import type { SlotId } from "./sim/slots";
import type { PieceInput } from "./sim/step";
import type { World } from "./sim/world";
import type { Vec } from "./vec";

export interface PlayerInfo {
  id: string;
  name: string;
  slot: SlotId | null;
  connected: boolean;
}

export interface RoomState {
  code: string;
  phase: "lobby" | "playing";
  hostId: string | null;
  players: PlayerInfo[];
}

export type ClientMessage =
  | { t: "ping"; id: number; clientTime: number }
  /** room: null creates a new room. token: rejoin as the same player (from a welcome). */
  | { t: "join"; room: string | null; name: string; token?: string }
  | { t: "pickSlot"; slot: SlotId | null }
  | { t: "start" }
  | { t: "stop" }
  /** One entry per client sim tick, in order; seq increases by 1 per tick (M4). */
  | { t: "input"; inputs: TickInput[] };

export interface TickInput {
  seq: number;
  input: PieceInput;
}

export type ServerMessage =
  | { t: "pong"; id: number; clientTime: number }
  | { t: "welcome"; room: string; playerId: string; token: string }
  | { t: "room"; room: RoomState }
  /** acks: slot → seq of the last input the server applied for that slot's player. */
  | { t: "snapshot"; world: World; acks: Record<string, number> }
  | { t: "error"; message: string };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

function parse(raw: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown, max = 64): v is string => typeof v === "string" && v.length <= max;
const isVec = (v: unknown): v is Vec =>
  typeof v === "object" && v !== null && isNum((v as Vec).x) && isNum((v as Vec).y);

function decodeInput(v: unknown): PieceInput | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const m = v as Record<string, unknown>;
  const input: PieceInput = {};
  if (m.target !== undefined) {
    if (!isVec(m.target)) return undefined;
    input.target = { x: m.target.x, y: m.target.y };
  }
  if (m.targetAngle !== undefined) {
    if (!isNum(m.targetAngle)) return undefined;
    input.targetAngle = m.targetAngle;
  }
  if (m.launch !== undefined) {
    const l = m.launch as Record<string, unknown> | null;
    if (typeof l !== "object" || l === null || !isNum(l.angle) || !isNum(l.power)) return undefined;
    input.launch = { angle: l.angle, power: l.power };
  }
  return input;
}

/** Returns the message, or undefined if `raw` is not a valid client message. */
export function decodeClientMessage(raw: string): ClientMessage | undefined {
  const m = parse(raw);
  if (!m) return undefined;
  switch (m.t) {
    case "ping":
      return isNum(m.id) && isNum(m.clientTime) ? { t: "ping", id: m.id, clientTime: m.clientTime } : undefined;
    case "join": {
      if (!(m.room === null || isStr(m.room, 16)) || !isStr(m.name)) return undefined;
      if (m.token !== undefined && !isStr(m.token)) return undefined;
      const msg: ClientMessage = { t: "join", room: m.room, name: m.name };
      if (m.token !== undefined) msg.token = m.token;
      return msg;
    }
    case "pickSlot":
      return m.slot === null || isStr(m.slot, 16) ? { t: "pickSlot", slot: m.slot } : undefined;
    case "start":
    case "stop":
      return { t: m.t };
    case "input": {
      if (!Array.isArray(m.inputs) || m.inputs.length > 16) return undefined;
      const inputs: TickInput[] = [];
      for (const entry of m.inputs as unknown[]) {
        const e = entry as Record<string, unknown> | null;
        if (typeof e !== "object" || e === null || !isNum(e.seq)) return undefined;
        const input = decodeInput(e.input);
        if (!input) return undefined;
        inputs.push({ seq: e.seq, input });
      }
      return { t: "input", inputs };
    }
    default:
      return undefined;
  }
}

const serverTypes = new Set(["pong", "welcome", "room", "snapshot", "error"]);

/** Returns the message, or undefined if `raw` is not a server message. The server is trusted. */
export function decodeServerMessage(raw: string): ServerMessage | undefined {
  const m = parse(raw);
  return m && typeof m.t === "string" && serverTypes.has(m.t) ? (m as unknown as ServerMessage) : undefined;
}
