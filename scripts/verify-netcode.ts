// Headless check for M4 netcode feel. Alice plays over a simulated bad link
// (?lag=200&jitter=60&loss=0.1); Bob and 6 bots fill the room. Measures, from frame-by-frame
// recordings in Alice's page:
//   - her own goalie responds to the mouse within a couple of frames (prediction), while the
//     server's copy lags by roughly the link delay;
//   - prediction settles onto the server's position (reconciliation);
//   - the puck never teleports while 10% of snapshots are dropped (the interpolation buffer
//     absorbs it), nor for a spectator, Carol, losing 60% (the client runs the sim forward
//     over the gaps).
// Needs `npm run dev` running. Screenshots land in screenshots/.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

const url = process.env.CLIENT_URL ?? "http://localhost:5173";
const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath) throw new Error("CHROMIUM_PATH is not set — run inside `nix develop`");
const LAG = 200;

type Vec = { x: number; y: number };
interface Sample { t: number; own: Vec; server: Vec; puck: Vec; held: number | null; score: string; extrap: number }

mkdirSync("screenshots", { recursive: true });
const browser = await chromium.launch({ executablePath });
const failures: string[] = [];
const check = (ok: boolean, msg: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures.push(msg);
};
const data = (page: Page, key: string): Promise<string> => page.evaluate((k) => document.body.dataset[k] ?? "", key);
const until = async (page: Page, key: string, pred: (v: string) => boolean, ms = 8000): Promise<string> => {
  const end = Date.now() + ms;
  let v = await data(page, key);
  while (!pred(v) && Date.now() < end) {
    await page.waitForTimeout(50);
    v = await data(page, key);
  }
  return v;
};
const moveTo = async (page: Page, p: Vec, steps = 1): Promise<void> => {
  const s = await page.evaluate((p) => window.__puck.toScreen(p), p);
  await page.mouse.move(s.x, s.y, { steps });
};

/** Records rendered vs. snapshot state every animation frame in the page. */
async function record(page: Page): Promise<void> {
  // Passed as a string: tsx would wrap a named inner function in a helper the page lacks.
  await page.evaluate(`(() => {
    const out = [];
    window.__log = out;
    const loop = (t) => {
      const r = window.__puck.rendered?.();
      const s = window.__puck.world();
      if (r && s) {
        out.push({
          t,
          own: r.goalies.find((g) => g.id === "t0-goalie").pos,
          server: s.goalies.find((g) => g.id === "t0-goalie").pos,
          puck: r.puck.pos,
          held: r.puck.heldBy,
          score: r.score.join("-"),
          extrap: Number(document.body.dataset.extrapolating),
        });
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  })()`);
}
const takeLog = (page: Page): Promise<Sample[]> => page.evaluate(() => window.__log.splice(0) as Sample[]);
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

let bots: ReturnType<typeof spawn> | undefined;
try {
  const alice = await (await browser.newContext({ viewport: { width: 1100, height: 650 } })).newPage();
  const bob = await (await browser.newContext({ viewport: { width: 1100, height: 650 } })).newPage();

  await alice.goto(`${url}/?lag=${LAG}&jitter=60&loss=0.1`);
  await alice.fill("#name", "Alice");
  await alice.click("#create");
  const code = await until(alice, "room", (v) => v.length === 4);
  await alice.click('[data-slot="t0-goalie"] button');
  await bob.goto(`${url}/?room=${code}`);
  await bob.fill("#name", "Bob");
  await bob.click("#join");
  await until(bob, "room", (v) => v === code);
  await bob.click('[data-slot="t1-goalie"] button');
  bots = spawn("tsx", ["server/src/bot.ts", "--room", code, "--count", "6", "--seconds", "60", "--seed", "3"], { stdio: "inherit" });
  const slotted = await until(alice, "slotted", (v) => v === "8");
  check(slotted === "8", `room ${code} full: Alice (lagged link) + Bob + 6 bots; Alice sees all 8 (in-order delivery)`);
  await alice.click("#start");
  await until(alice, "phase", (v) => v === "playing");

  // Park Alice's goalie, then let everything settle.
  await moveTo(alice, { x: 55, y: 300 });
  await alice.waitForTimeout(1500);
  await record(alice);

  // 1. Responsiveness: one instant mouse move inside the box.
  await takeLog(alice);
  const t0 = await alice.evaluate(() => performance.now());
  await moveTo(alice, { x: 55, y: 200 });
  await alice.waitForTimeout(1200);
  const log = (await takeLog(alice)).filter((s) => s.t >= t0);
  const start = log[0]!;
  const firstMove = (key: "own" | "server"): number => {
    const s = log.find((x) => dist(x[key], start[key]) > 2);
    return s ? s.t - t0 : Infinity;
  };
  const ownMs = firstMove("own");
  const serverMs = firstMove("server");
  console.log(`     own goalie moved after ${ownMs.toFixed(0)} ms; server copy after ${serverMs.toFixed(0)} ms`);
  check(ownMs < 60, `own piece responds without network lag (${ownMs.toFixed(0)} ms)`);
  check(serverMs > LAG / 2, `server copy is genuinely lagged (${serverMs.toFixed(0)} ms), so prediction is doing the work`);
  const end = log.at(-1)!;
  check(dist(end.own, end.server) < 1, `prediction settles onto the server position (gap ${dist(end.own, end.server).toFixed(2)})`);
  check(Math.abs(end.own.y - 200 - 0) < 30 || end.own.y <= 200 + 1, `goalie reached its (clamped) target (y ${end.own.y.toFixed(0)})`);

  // 2. Puck smoothness under loss: Carol spectates over a very lossy link.
  const carol = await (await browser.newContext({ viewport: { width: 1100, height: 650 } })).newPage();
  await carol.goto(`${url}/?room=${code}&loss=0.6`);
  await carol.fill("#name", "Carol");
  await carol.click("#join");
  await until(carol, "phase", (v) => v === "playing");
  await carol.waitForTimeout(500);
  await record(carol);
  await takeLog(carol);

  // Shoot and record the rendered puck on both lossy clients.
  await moveTo(alice, { x: 55, y: 300 });
  await alice.waitForTimeout(1200);
  await alice.keyboard.press("F3");
  await takeLog(alice);
  // Whoever holds the puck shoots (kickoff is random; it may have been caught or auto-shot
  // since). Wait for a goalie to have it.
  const held = await until(bob, "held", (v) => v === "0" || v === "1", 8000);
  const [shooter, dir] = held === "0" ? [alice, 1] : [bob, -1];
  await moveTo(shooter, { x: 600, y: 300 });
  await shooter.waitForTimeout(800);
  await shooter.mouse.down();
  await moveTo(shooter, { x: 600 - 200 * dir, y: 340 }, 10);
  await shooter.mouse.up();
  await alice.waitForTimeout(700);
  await alice.screenshot({ path: "screenshots/netcode-01-alice-lagged-debug.png" });
  await alice.waitForTimeout(1300);
  const analyse = (flight: Sample[]) => {
    let worst = 0;
    let moving = 0;
    let extrapolated = 0;
    for (let i = 1; i < flight.length; i++) {
      const a = flight[i - 1]!;
      const b = flight[i]!;
      if (a.held !== b.held || a.score !== b.score) continue; // launch / goal teleports are real
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) continue;
      const v = dist(a.puck, b.puck) / dt;
      if (v > 1) moving++;
      worst = Math.max(worst, v);
      if (b.extrap > 0.5) extrapolated++;
    }
    return { frames: flight.length, worst, moving, extrapolated };
  };
  const maxShot = 1600;
  for (const [who, page, loss] of [["Alice", alice, "10%"], ["Carol", carol, "60%"]] as const) {
    const r = analyse(await takeLog(page));
    console.log(`     ${who}: ${r.frames} frames, ${r.moving} with the puck moving, ${r.extrapolated} extrapolated; worst apparent speed ${r.worst.toFixed(0)} u/s`);
    check(r.moving > 20, `${who}: puck was in flight during the recording`);
    if (who === "Carol") check(r.extrapolated > 0, "Carol: lost snapshots were bridged by extrapolation");
    check(r.worst < maxShot * 1.6, `${who}: no visible teleports at ${loss} snapshot loss (worst ${r.worst.toFixed(0)} u/s, max shot ${maxShot})`);
  }
  await carol.keyboard.press("F3");
  await carol.waitForTimeout(300);
  await carol.screenshot({ path: "screenshots/netcode-03-carol-lossy-debug.png" });
  await bob.screenshot({ path: "screenshots/netcode-02-bob.png" });
} finally {
  bots?.kill("SIGTERM");
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
