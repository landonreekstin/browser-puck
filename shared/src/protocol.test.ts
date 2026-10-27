import { describe, expect, it } from "vitest";
import { decodeClientMessage, decodeServerMessage, encode, type ClientMessage } from "./protocol";

describe("protocol", () => {
  it("round-trips every client message", () => {
    const msgs: ClientMessage[] = [
      { t: "ping", id: 3, clientTime: 12.5 },
      { t: "join", room: null, name: "Ann" },
      { t: "join", room: "ABCD", name: "Ann", token: "tok" },
      { t: "pickSlot", slot: "t0-goalie" },
      { t: "pickSlot", slot: null },
      { t: "start" },
      { t: "stop" },
      { t: "input", input: { target: { x: 1, y: 2 }, targetAngle: 0.5, launch: { angle: 1, power: 0.5 } } },
      { t: "input", input: {} },
    ];
    for (const m of msgs) expect(decodeClientMessage(encode(m))).toEqual(m);
  });

  it("round-trips a pong", () => {
    const pong = { t: "pong", id: 3, clientTime: 12.5 } as const;
    expect(decodeServerMessage(encode(pong))).toEqual(pong);
  });

  it("rejects garbage, bad fields and wrong-direction messages", () => {
    const bad = [
      "not json",
      "null",
      "[]",
      JSON.stringify({ t: "ping", id: "x", clientTime: 1 }),
      JSON.stringify({ t: "join", room: 5, name: "a" }),
      JSON.stringify({ t: "join", room: null, name: "x".repeat(500) }),
      JSON.stringify({ t: "input", input: { target: { x: "1", y: 2 } } }),
      JSON.stringify({ t: "input", input: { launch: { angle: 1 } } }),
      JSON.stringify({ t: "input", input: { targetAngle: null } }),
      JSON.stringify({ t: "snapshot", world: {} }),
      encode({ t: "pong", id: 1, clientTime: 1 }),
    ];
    for (const raw of bad) expect(decodeClientMessage(raw)).toBeUndefined();
    expect(decodeServerMessage("null")).toBeUndefined();
    expect(decodeServerMessage(JSON.stringify({ t: "nope" }))).toBeUndefined();
  });

  it("drops unknown fields from inputs (clients can't smuggle state)", () => {
    const raw = JSON.stringify({ t: "input", input: { target: { x: 1, y: 2, z: 3 }, pos: { x: 0, y: 0 } } });
    expect(decodeClientMessage(raw)).toEqual({ t: "input", input: { target: { x: 1, y: 2 } } });
  });
});
