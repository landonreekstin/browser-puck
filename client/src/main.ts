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
import { Controls } from "./controls";
import { Net } from "./net";
import { interpolate, render } from "./render";
import { createTuningPanel } from "./tuning";
import { View } from "./view";

// M1: offline physics sandbox. The shared sim runs here at a fixed rate; rendering
// interpolates between ticks. Networking is only the ping readout (debug overlay).

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const cfg = cloneConfig(defaultConfig);
const view = new View();
const net = new Net();

let world: World = createWorld(cfg);
let prev: World = cloneWorld(world);
const controls = new Controls(canvas, view, () => world, () => cfg);

let showDebug = false;
let contacts: { contact: Contact; age: number }[] = [];
let lastSubsteps = 0;
let goalFlash = 0;
let fps = 60;

const tuning = createTuningPanel(cfg, () => {
  world = createWorld(cfg);
  prev = cloneWorld(world);
  controls.selected = Math.min(controls.selected, controls.pieceCount() - 1);
});
document.body.append(tuning);

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "F3" || e.key === "`") {
    e.preventDefault();
    showDebug = !showDebug;
  } else if (e.key.toLowerCase() === "t") {
    tuning.hidden = !tuning.hidden;
  }
});

function tick(): void {
  const dt = 1 / cfg.sim.tickRate;
  if (controls.givePuckRequested) {
    controls.givePuckRequested = false;
    givePuck(world, controls.selectedPiece().team);
  }
  prev = cloneWorld(world);
  const events = step(world, cfg, controls.collect(dt));
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

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.fit(cfg, w, h);

  const piece = controls.selectedPiece();
  const launch = controls.currentLaunch();
  const aiming = piece.kind === "goalie" && controls.dragStart !== null;

  render(ctx, w, h, {
    cfg,
    view,
    world: interpolate(prev, world, acc / dt),
    selectedId: piece.id,
    aim: aiming ? { launch, path: launch ? predictPath(world, cfg, piece.team, launch) : [] } : null,
    debug: showDebug
      ? { contacts, fps, substeps: lastSubsteps, net: `${net.status}${net.rttMs !== undefined ? ` ${net.rttMs.toFixed(1)} ms` : ""}` }
      : null,
    goalFlash,
  });

  exposeForVerification();
  requestAnimationFrame(frame);
}

/** State for scripted headless checks (scripts/verify-sandbox.ts). */
function exposeForVerification(): void {
  const d = document.body.dataset;
  d.ready = "1";
  d.score = world.score.join("-");
  d.held = String(world.puck.heldBy ?? "");
  d.puckSpeed = Math.hypot(world.puck.vel.x, world.puck.vel.y).toFixed(1);
  d.selected = controls.selectedPiece().id;
}

declare global {
  interface Window {
    __puck: { world: () => World; toScreen: (p: Vec) => Vec };
  }
}
window.__puck = { world: () => world, toScreen: (p) => view.toScreen(p) };

net.start();
requestAnimationFrame(frame);
