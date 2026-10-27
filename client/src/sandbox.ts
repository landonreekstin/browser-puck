import {
  cloneConfig,
  cloneWorld,
  createWorld,
  defaultConfig,
  givePuck,
  predictPath,
  step,
  type Contact,
  type Vec,
  type World,
} from "@puck/shared";
import { Controls, type ControlledPiece } from "./controls";
import type { Net } from "./net";
import { fitCanvas, interpolate, render } from "./render";
import { createTuningPanel } from "./tuning";
import { View } from "./view";

/**
 * M1 offline sandbox (`?sandbox`): the shared sim runs locally at a fixed rate and one
 * person drives any piece. 1–6/Tab select · R give puck · F3 debug · T tuning.
 */
export function startSandbox(canvas: HTMLCanvasElement, net: Net): void {
  const ctx = canvas.getContext("2d")!;
  const cfg = cloneConfig(defaultConfig);
  const view = new View();

  let world: World = createWorld(cfg);
  let prev: World = cloneWorld(world);
  const controls = new Controls(canvas, view, () => cfg);
  let selected = 0;

  /** Selection order: team 0 goalie, team 0 bars, team 1 goalie, team 1 bars. */
  const pieces = (): ControlledPiece[] =>
    ([0, 1] as const).flatMap((team) => [
      ...world.goalies.filter((g) => g.team === team).map((g) => ({ id: g.id, kind: "goalie" as const, team })),
      ...world.blockers.filter((b) => b.team === team).map((b) => ({ id: b.id, kind: "blocker" as const, team })),
    ]);
  const select = (i: number): void => {
    const all = pieces();
    selected = (i + all.length) % all.length;
    controls.setPiece(all[selected]!);
  };
  select(0);

  let showDebug = false;
  let contacts: { contact: Contact; age: number }[] = [];
  let lastSubsteps = 0;
  let goalFlash = 0;
  let fps = 60;

  const tuning = createTuningPanel(cfg, () => {
    world = createWorld(cfg);
    prev = cloneWorld(world);
    controls.setPiece(null);
    select(Math.min(selected, pieces().length - 1));
  });
  document.body.append(tuning);

  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const key = e.key.toLowerCase();
    const digit = Number(key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= pieces().length) select(digit - 1);
    else if (key === "tab") {
      e.preventDefault();
      select(selected + (e.shiftKey ? -1 : 1));
    } else if (key === "r") givePuck(world, controls.piece!.team);
    else if (key === "f3" || key === "`") {
      e.preventDefault();
      showDebug = !showDebug;
    } else if (key === "t") tuning.hidden = !tuning.hidden;
  });

  function tick(): void {
    const dt = 1 / cfg.sim.tickRate;
    prev = cloneWorld(world);
    const bar = world.blockers.find((b) => b.id === controls.piece?.id);
    const input = controls.collect(dt, bar ? bar.angle : null);
    const events = step(world, cfg, input && controls.piece ? { [controls.piece.id]: input } : {});
    lastSubsteps = events.substeps;
    for (const contact of events.contacts) contacts.push({ contact, age: 0 });
    if (events.goal) {
      goalFlash = 1;
      prev = cloneWorld(world); // the puck teleported; don't interpolate across it
    }
  }

  let last = performance.now();
  let acc = 0;

  function frame(now: number): void {
    const elapsed = Math.min(now - last, 250) / 1000;
    last = now;
    fps = fps * 0.95 + (elapsed > 0 ? 1 / elapsed : fps) * 0.05;

    const dt = 1 / cfg.sim.tickRate;
    acc += elapsed;
    while (acc >= dt) {
      tick();
      acc -= dt;
    }
    contacts = contacts.filter((c) => (c.age += elapsed) < 0.8);
    goalFlash = Math.max(0, goalFlash - elapsed * 1.5);

    const { w, h } = fitCanvas(canvas, ctx);
    view.fit(cfg, w, h);
    const piece = controls.piece!;
    const launch = controls.currentLaunch();
    const aiming = piece.kind === "goalie" && controls.dragStart !== null;

    render(ctx, w, h, {
      cfg,
      view,
      world: interpolate(prev, world, acc / dt),
      selectedId: piece.id,
      aim: aiming ? { launch, path: launch ? predictPath(world, cfg, piece.team, launch) : [] } : null,
      debug: showDebug ? { contacts, fps, substeps: lastSubsteps, net: net.describe() } : null,
      goalFlash,
      labels: {},
      help: "1–6/Tab select · mouse move · drag shoot (goalie) · wheel/Q/E rotate (bar) · R give puck · F3 debug · T tuning",
    });

    // State for scripted headless checks (scripts/verify-sandbox.ts).
    const d = document.body.dataset;
    d.ready = "1";
    d.score = world.score.join("-");
    d.held = String(world.puck.heldBy ?? "");
    d.puckSpeed = Math.hypot(world.puck.vel.x, world.puck.vel.y).toFixed(1);
    d.selected = piece.id;
    requestAnimationFrame(frame);
  }

  window.__puck = { world: () => world, toScreen: (p: Vec) => view.toScreen(p) };
  requestAnimationFrame(frame);
}
