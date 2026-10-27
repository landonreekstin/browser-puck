// Headless check for M5 touch controls (DESIGN.md "Touch controls"), in the sandbox, using
// real touch input (CDP touch events → pointer events with pointerType "touch").
// Needs `npm run dev` running. Screenshots land in screenshots/.
import { mkdirSync } from "node:fs";
import { chromium, type CDPSession, type Page } from "playwright-core";

const url = process.env.CLIENT_URL ?? "http://localhost:5173";
const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath) throw new Error("CHROMIUM_PATH is not set — run inside `nix develop`");

type Vec = { x: number; y: number };
interface Piece { id: string; pos: Vec; angle?: number }
interface WorldView { puck: { heldBy: number | null; vel: Vec }; goalies: Piece[]; blockers: Piece[] }

mkdirSync("screenshots", { recursive: true });
const browser = await chromium.launch({ executablePath });
const page: Page = await (await browser.newContext({ viewport: { width: 1000, height: 560 }, hasTouch: true })).newPage();
const cdp: CDPSession = await page.context().newCDPSession(page);
const failures: string[] = [];
const check = (ok: boolean, msg: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures.push(msg);
};
const world = (): Promise<WorldView> => page.evaluate(() => window.__puck.world() as WorldView);
const screen = (p: Vec): Promise<Vec> => page.evaluate((p) => window.__puck.toScreen(p), p);
const wait = (ms: number): Promise<void> => page.waitForTimeout(ms);
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Touch points in world coords; one call = one touch event with all current fingers. */
async function touch(type: "touchStart" | "touchMove" | "touchEnd", points: Vec[]): Promise<void> {
  const touchPoints = await Promise.all(points.map(async (p, id) => ({ ...(await screen(p)), id })));
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : touchPoints });
}
async function drag(from: Vec, to: Vec, steps = 8): Promise<void> {
  await touch("touchStart", [from]);
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
    await wait(16);
  }
}

try {
  await page.goto(`${url}/?sandbox`);
  await page.waitForFunction(() => document.body.dataset.ready === "1");

  // Goalie: a touch on it drags it; after release it stays put.
  const g0 = (await world()).goalies.find((g) => g.id === "t0-goalie")!;
  await drag(g0.pos, { x: g0.pos.x, y: 200 });
  await wait(500);
  await touch("touchEnd", []);
  await wait(400);
  const g1 = (await world()).goalies.find((g) => g.id === "t0-goalie")!;
  check(Math.abs(g1.pos.y - 200) < 3, `touch on the goalie drags it (y ${g1.pos.y.toFixed(0)})`);
  check((await world()).puck.heldBy === 0, "dragging the goalie doesn't shoot");

  // Goalie: a touch elsewhere is the slingshot; the goalie doesn't follow the finger.
  await drag({ x: 600, y: 200 }, { x: 400, y: 200 });
  await wait(100);
  await page.screenshot({ path: "screenshots/touch-01-aiming.png" });
  await touch("touchEnd", []);
  await wait(150);
  const w = await world();
  const g2 = w.goalies.find((g) => g.id === "t0-goalie")!;
  check(w.puck.heldBy === null && Math.hypot(w.puck.vel.x, w.puck.vel.y) > 300, "touch slingshot launches the puck");
  check(dist(g2.pos, g1.pos) < 3, "the goalie stays put while aiming and after release");

  // Blocker: rotate buttons appear; one finger drags the bar; two fingers twist it.
  await page.keyboard.press("2");
  await wait(100);
  check(await page.locator("#rotate-buttons").isVisible(), "rotate buttons shown for a blocker on touch");
  const b0 = (await world()).blockers.find((b) => b.id === "t0-b0")!;
  await drag(b0.pos, { x: 300, y: 130 });
  await wait(500);
  const b1 = (await world()).blockers.find((b) => b.id === "t0-b0")!;
  check(dist(b1.pos, { x: 300, y: 130 }) < 3, `one finger drags the bar (${b1.pos.x.toFixed(0)}, ${b1.pos.y.toFixed(0)})`);
  // Second finger down to the right, then swing it around the first: a quarter turn.
  const pivot = { x: 300, y: 130 };
  await touch("touchStart", [pivot, { x: 400, y: 130 }]);
  for (let i = 1; i <= 8; i++) {
    const a = (Math.PI / 2) * (i / 8);
    await touch("touchMove", [pivot, { x: 300 + 100 * Math.cos(a), y: 130 + 100 * Math.sin(a) }]);
    await wait(16);
  }
  await touch("touchEnd", []);
  await wait(400);
  const b2 = (await world()).blockers.find((b) => b.id === "t0-b0")!;
  const turned = (b2.angle ?? 0) - (b1.angle ?? 0);
  check(Math.abs(turned - Math.PI / 2) < 0.2, `two-finger twist rotates the bar (${turned.toFixed(2)} rad)`);
  check(dist(b2.pos, b1.pos) < 3, "the bar stays put after the fingers lift");

  // ⟳ button rotates while held.
  const button = await page.locator('#rotate-buttons button[data-key="e"]').boundingBox();
  const center = { x: button!.x + button!.width / 2, y: button!.y + button!.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...center, id: 0 }] });
  await wait(300);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await wait(300);
  const b3 = (await world()).blockers.find((b) => b.id === "t0-b0")!;
  check((b3.angle ?? 0) - (b2.angle ?? 0) > 0.5, `holding ⟳ rotates the bar (${((b3.angle ?? 0) - (b2.angle ?? 0)).toFixed(2)} rad)`);
  check(dist(b3.pos, b2.pos) < 3, "pressing a button doesn't move the bar");
  await page.screenshot({ path: "screenshots/touch-02-blocker.png" });
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
