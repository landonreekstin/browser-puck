import {
  cloneWorld,
  defaultConfig as cfg,
  predictPath,
  Predictor,
  slotInfo,
  type GameEvent,
  type RoomState,
  type TickInput,
  type Vec,
  type World,
} from "@puck/shared";
import { Controls } from "./controls";
import { Effects } from "./effects";
import { Lobby } from "./lobby";
import type { Net } from "./net";
import { fitCanvas, render } from "./render";
import { SnapshotBuffer } from "./snapshots";
import { Sfx } from "./sound";
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
 * Online play: lobby → server-authoritative match. The client sends one input per sim tick
 * and draws interpolated server snapshots, except for its own piece, which is predicted
 * locally from those same inputs (M4) so it responds without network lag.
 */
export function startOnline(canvas: HTMLCanvasElement, net: Net, roomFromUrl: string | null): void {
  const ctx = canvas.getContext("2d")!;
  const view = new View();
  const controls = new Controls(canvas, view, () => cfg);
  const snapshots = new SnapshotBuffer(cfg);
  const predictor = new Predictor(cfg);
  const effects = new Effects(cfg);
  const sfx = new Sfx();
  /** Events from snapshots, played when their tick is rendered (so they match the picture). */
  let events: GameEvent[] = [];
  let seq = 0;
  let batch: TickInput[] = [];

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
        // The server resets our seq on (re)join.
        seq = 0;
        batch = [];
        predictor.reset();
        save(`puck.token.${msg.room}`, msg.token);
        history.replaceState(null, "", `?room=${msg.room}`);
        lobby.showError("");
        break;
      case "room": {
        const wasPlaying = room?.phase === "playing";
        room = msg.room;
        if (room.phase === "playing" && !wasPlaying) {
          snapshots.reset();
          events = [];
        }
        const before = controls.piece?.id;
        if (me) lobby.renderRoom(room, me.playerId);
        const slot = room.players.find((p) => p.id === me?.playerId)?.slot ?? null;
        const info = slot && room.phase === "playing" ? slotInfo(cfg, slot) : undefined;
        controls.setPiece(info ? { id: info.id, kind: info.kind, team: info.team } : null);
        if (controls.piece?.id !== before || (room.phase === "playing" && !wasPlaying)) predictor.reset();
        break;
      }
      case "snapshot":
        snapshots.push(msg.world);
        events.push(...msg.events);
        if (events.length > 300) events.splice(0, events.length - 300);
        if (controls.piece) predictor.reconcile(msg.world, controls.piece.id, msg.acks[controls.piece.id]);
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

  // Inputs: one per sim tick (the server consumes one per tick), predicted locally right
  // away and sent in batches at net.inputRate. Shots go out immediately.
  const tickDt = 1 / cfg.sim.tickRate;
  const ticksPerSend = Math.max(1, Math.round(cfg.sim.tickRate / cfg.net.inputRate));
  let inputAcc = 0;
  const sendInputs = (elapsed: number): void => {
    inputAcc += elapsed;
    while (inputAcc >= tickDt) {
      inputAcc -= tickDt;
      if (!snapshots.latest() || room?.phase !== "playing") continue;
      const input = controls.collect(tickDt, predictor.rawAngle());
      if (!input) continue;
      const entry = { seq: seq++, input };
      predictor.tick(entry);
      batch.push(entry);
      if (batch.length >= ticksPerSend || input.launch) {
        net.send({ t: "input", inputs: batch });
        batch = [];
      }
    }
  };

  /** Draw our own piece where we predict it, not where the (older) snapshot has it. */
  const withPrediction = (world: World): World => {
    const piece = controls.piece;
    const pose = predictor.pose();
    if (!piece || !pose) return world;
    const w = { ...world, puck: { ...world.puck } };
    if (piece.kind === "goalie") {
      w.goalies = world.goalies.map((g) => (g.id === piece.id ? { ...g, pos: pose.pos } : g));
      if (world.puck.heldBy === piece.team) w.puck.pos = pose.pos;
    } else {
      w.blockers = world.blockers.map((b) => (b.id === piece.id ? { ...b, pos: pose.pos, angle: pose.angle } : b));
    }
    return w;
  };
  let rendered: World | undefined;

  let last = performance.now();
  let fps = 60;
  function frame(now: number): void {
    const elapsed = Math.min(now - last, 250) / 1000;
    last = now;
    fps = fps * 0.95 + (elapsed > 0 ? 1 / elapsed : fps) * 0.05;
    sendInputs(elapsed);
    predictor.decay(elapsed);

    const { w, h } = fitCanvas(canvas, ctx);
    view.fit(cfg, w, h);
    const sampled = room?.phase === "playing" ? snapshots.sample(elapsed) : undefined;
    const world = sampled ? withPrediction(sampled) : undefined;
    rendered = world;
    if (world) {
      while (events[0] && events[0].tick <= snapshots.renderTick) {
        const e = events.shift()!;
        effects.event(e, world);
        sfx.play(e);
      }
      effects.update(elapsed, world);
      const piece = controls.piece;
      const launch = controls.currentLaunch();
      // Aim preview from the newest snapshot, with our goalie (and held puck) where we see it.
      const latest = withPrediction(cloneWorld(snapshots.latest()!));
      const labels: Record<string, string> = {};
      for (const p of room?.players ?? []) {
        if (p.slot) labels[p.slot] = p.id === me?.playerId ? `${p.name} (you)` : p.name;
      }
      render(ctx, w, h, {
        cfg,
        view,
        world,
        effects,
        selectedId: piece?.id ?? "",
        aim:
          piece?.kind === "goalie" && controls.dragStart
            ? { launch, path: launch ? predictPath(latest, cfg, piece.team, launch) : [] }
            : null,
        debug: showDebug
          ? {
              contacts: [],
              fps,
              substeps: 0,
              net: net.describe(),
              lines: [
                `prediction correction ${predictor.lastCorrection.toFixed(1)} u · extrapolating ${snapshots.extrapolatingTicks.toFixed(1)} ticks`,
              ],
            }
          : null,
        goalFlash: 0,
        labels,
        help: `room ${room?.code ?? ""} · mouse move · drag shoot (goalie) · wheel/Q/E rotate (bar) · F3 debug · M sound ${sfx.isMuted ? "off" : "on"}`,
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
    d.extrapolating = snapshots.extrapolatingTicks.toFixed(2);
    d.sounds = String(sfx.played);
    d.puckSpeed = latest ? Math.hypot(latest.puck.vel.x, latest.puck.vel.y).toFixed(1) : "";
    requestAnimationFrame(frame);
  }

  window.__puck = {
    world: () => snapshots.latest(),
    rendered: () => rendered,
    toScreen: (p: Vec) => view.toScreen(p),
  };
  requestAnimationFrame(frame);
}

declare global {
  interface Window {
    __puck: { world: () => World | undefined; rendered?: () => World | undefined; toScreen: (p: Vec) => Vec };
  }
}
