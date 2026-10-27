import {
  defaultConfig as cfg,
  predictPath,
  slotInfo,
  type PieceInput,
  type RoomState,
  type Vec,
  type World,
} from "@puck/shared";
import { Controls } from "./controls";
import { Lobby } from "./lobby";
import type { Net } from "./net";
import { fitCanvas, render } from "./render";
import { SnapshotBuffer } from "./snapshots";
import { View } from "./view";

// Browser storage is a convenience only: it can be missing or throw.
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/**
 * Online play (M2): lobby → server-authoritative match. This client only sends inputs and
 * draws interpolated server snapshots — including its own piece (prediction is M4).
 */
export function startOnline(canvas: HTMLCanvasElement, net: Net, roomFromUrl: string | null): void {
  const ctx = canvas.getContext("2d")!;
  const view = new View();
  const controls = new Controls(canvas, view, () => cfg);
  const snapshots = new SnapshotBuffer(cfg);

  let room: RoomState | null = null;
  let me: { playerId: string; code: string } | null = null;
  let name = load("puck.name") ?? "";
  /** Room we want to be in; (re)joined on every connect. */
  let wanted: string | null = roomFromUrl ? roomFromUrl.toUpperCase() : null;
  let showDebug = false;

  const join = (code: string | null): void => {
    wanted = code;
    save("puck.name", name);
    const token = code ? load(`puck.token.${code}`) : null;
    net.send(token ? { t: "join", room: code, name, token } : { t: "join", room: code, name });
  };

  const lobby = new Lobby(
    cfg,
    {
      create: (n) => {
        name = n;
        join(null);
      },
      join: (code, n) => {
        name = n;
        join(code);
      },
      pickSlot: (slot) => net.send({ t: "pickSlot", slot }),
      start: () => net.send({ t: "start" }),
      stop: () => net.send({ t: "stop" }),
    },
    name,
    wanted ?? "",
  );

  net.onOpen = () => {
    // Rejoin after a reconnect, or auto-join a link we've been in before.
    if (me) join(me.code);
    else if (wanted && load(`puck.token.${wanted}`)) join(wanted);
  };

  net.onMessage = (msg) => {
    switch (msg.t) {
      case "welcome":
        me = { playerId: msg.playerId, code: msg.room };
        save(`puck.token.${msg.room}`, msg.token);
        history.replaceState(null, "", `?room=${msg.room}`);
        lobby.showError("");
        break;
      case "room": {
        const wasPlaying = room?.phase === "playing";
        room = msg.room;
        if (room.phase === "playing" && !wasPlaying) snapshots.reset();
        if (me) lobby.renderRoom(room, me.playerId);
        const slot = room.players.find((p) => p.id === me?.playerId)?.slot ?? null;
        const info = slot && room.phase === "playing" ? slotInfo(cfg, slot) : undefined;
        controls.setPiece(info ? { id: info.id, kind: info.kind, team: info.team } : null);
        break;
      }
      case "snapshot":
        snapshots.push(msg.world);
        break;
      case "error":
        lobby.showError(msg.message);
        break;
    }
  };

  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "F3" || e.key === "`") {
      e.preventDefault();
      showDebug = !showDebug;
    }
  });

  // Inputs: sampled at the sim rate, sent when they change (at most net.inputRate per
  // second). Shots go out immediately.
  const tickDt = 1 / cfg.sim.tickRate;
  let inputAcc = 0;
  let lastSent = "";
  let lastSentAt = 0;
  const sendInputs = (elapsed: number, now: number): void => {
    const world = snapshots.latest();
    inputAcc += elapsed;
    while (inputAcc >= tickDt) {
      inputAcc -= tickDt;
      if (!world || room?.phase !== "playing") continue;
      const input: PieceInput | null = controls.collect(tickDt, world);
      if (!input) continue;
      const key = JSON.stringify({ ...input, launch: undefined });
      const due = now - lastSentAt >= 1000 / cfg.net.inputRate;
      if (input.launch || (key !== lastSent && due)) {
        net.send({ t: "input", input });
        lastSent = key;
        lastSentAt = now;
      }
    }
  };

  let last = performance.now();
  let fps = 60;
  function frame(now: number): void {
    const elapsed = Math.min(now - last, 250) / 1000;
    last = now;
    fps = fps * 0.95 + (elapsed > 0 ? 1 / elapsed : fps) * 0.05;
    sendInputs(elapsed, now);

    const { w, h } = fitCanvas(canvas, ctx);
    view.fit(cfg, w, h);
    const world = room?.phase === "playing" ? snapshots.sample(elapsed) : undefined;
    if (world) {
      const piece = controls.piece;
      const launch = controls.currentLaunch();
      const latest = snapshots.latest()!;
      const labels: Record<string, string> = {};
      for (const p of room?.players ?? []) {
        if (p.slot) labels[p.slot] = p.id === me?.playerId ? `${p.name} (you)` : p.name;
      }
      render(ctx, w, h, {
        cfg,
        view,
        world,
        selectedId: piece?.id ?? "",
        aim:
          piece?.kind === "goalie" && controls.dragStart
            ? { launch, path: launch ? predictPath(latest, cfg, piece.team, launch) : [] }
            : null,
        debug: showDebug ? { contacts: [], fps, substeps: 0, net: net.describe() } : null,
        goalFlash: 0,
        labels,
        help: `room ${room?.code ?? ""} · mouse move · drag shoot (goalie) · wheel/Q/E rotate (bar) · F3 debug`,
      });
    } else {
      ctx.fillStyle = "#111418";
      ctx.fillRect(0, 0, w, h);
    }

    // State for scripted headless checks (scripts/verify-room.ts).
    const d = document.body.dataset;
    const mine = room?.players.find((p) => p.id === me?.playerId);
    d.ready = "1";
    d.room = room?.code ?? "";
    d.phase = room?.phase ?? "";
    d.slot = mine?.slot ?? "";
    d.slotted = String(room?.players.filter((p) => p.slot).length ?? 0);
    const latest = snapshots.latest();
    d.score = latest ? latest.score.join("-") : "";
    d.held = latest ? String(latest.puck.heldBy ?? "") : "";
    d.puckSpeed = latest ? Math.hypot(latest.puck.vel.x, latest.puck.vel.y).toFixed(1) : "";
    requestAnimationFrame(frame);
  }

  window.__puck = { world: () => snapshots.latest(), toScreen: (p: Vec) => view.toScreen(p) };
  requestAnimationFrame(frame);
}

declare global {
  interface Window {
    __puck: { world: () => World | undefined; toScreen: (p: Vec) => Vec };
  }
}
