// Wire messages between client and server. JSON for now; swap the encoding here if needed.

export type ClientMessage = { t: "ping"; id: number; clientTime: number };

export type ServerMessage = { t: "pong"; id: number; clientTime: number };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isPingOrPong(v: unknown, t: "ping" | "pong"): boolean {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return m.t === t && typeof m.id === "number" && typeof m.clientTime === "number";
}

/** Returns the message, or undefined if `raw` is not a valid client message. */
export function decodeClientMessage(raw: string): ClientMessage | undefined {
  const v = parse(raw);
  return isPingOrPong(v, "ping") ? (v as ClientMessage) : undefined;
}

/** Returns the message, or undefined if `raw` is not a valid server message. */
export function decodeServerMessage(raw: string): ServerMessage | undefined {
  const v = parse(raw);
  return isPingOrPong(v, "pong") ? (v as ServerMessage) : undefined;
}
