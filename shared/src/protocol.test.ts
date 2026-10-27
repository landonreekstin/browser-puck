import { describe, expect, it } from "vitest";
import { decodeClientMessage, decodeServerMessage, encode } from "./protocol";

describe("protocol", () => {
  it("round-trips a ping", () => {
    const ping = { t: "ping", id: 3, clientTime: 12.5 } as const;
    expect(decodeClientMessage(encode(ping))).toEqual(ping);
  });

  it("round-trips a pong", () => {
    const pong = { t: "pong", id: 3, clientTime: 12.5 } as const;
    expect(decodeServerMessage(encode(pong))).toEqual(pong);
  });

  it("rejects garbage and wrong-direction messages", () => {
    expect(decodeClientMessage("not json")).toBeUndefined();
    expect(decodeClientMessage(JSON.stringify({ t: "ping", id: "x", clientTime: 1 }))).toBeUndefined();
    expect(decodeClientMessage(encode({ t: "pong", id: 1, clientTime: 1 }))).toBeUndefined();
    expect(decodeServerMessage("null")).toBeUndefined();
  });
});
