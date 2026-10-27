// Headless check for M1: drives the offline sandbox through its real mouse/keyboard UI —
// moves and rotates a bar, clears the far goalie, aims (with preview) and scores a goal.
// Needs `npm run dev` running. Screenshots land in screenshots/.
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

const url = process.env.CLIENT_URL ?? "http://localhost:5173";
const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath) throw new Error("CHROMIUM_PATH is not set — run inside `nix develop`");

type Vec = { x: number; y: number };
interface Piece { id: string; pos: Vec; angle?: number }
interface WorldView { score: [number, number]; puck: { heldBy: number | null }; goalies: Piece[]; blockers: Piece[] }

mkdirSync("screenshots", { recursive: true });
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const failures: string[] = [];
const check = (ok: boolean, msg: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures.push(msg);
};

const toScreen = (p: Vec): Promise<Vec> => page.evaluate((p) => window.__puck.toScreen(p), p);
const world = (): Promise<WorldView> => page.evaluate(() => window.__puck.world() as unknown as WorldView);
const shot = (name: string): Promise<Buffer> => page.screenshot({ path: `screenshots/sandbox-${name}.png` });
const wait = (ms: number): Promise<void> => page.waitForTimeout(ms);
async function moveTo(page: Page, p: Vec, steps = 10): Promise<void> {
  const s = await toScreen(p);
  await page.mouse.move(s.x, s.y, { steps });
}

declare global {
  interface Window { __puck: { world: () => unknown; toScreen: (p: Vec) => Vec } }
}

try {
  await page.goto(`${url}/?sandbox`);
  await page.waitForFunction(() => document.body.dataset.ready === "1");
  await shot("01-initial");
  const w0 = await world();
  check(w0.puck.heldBy === 0, "team 0 goalie starts with the puck");

  // Bar: select piece 2, move it up out of the shooting lane and rotate it with E.
  await page.keyboard.press("2");
  await moveTo(page, { x: 400, y: 120 });
  await page.keyboard.down("e");
  await wait(250);
  await page.keyboard.up("e");
  await wait(600);
  const bar = (await world()).blockers.find((b) => b.id === "t0-b0")!;
  check(Math.hypot(bar.pos.x - 400, bar.pos.y - 120) < 2, `bar moved to its target (${bar.pos.x.toFixed(0)}, ${bar.pos.y.toFixed(0)})`);
  check(Math.abs((bar.angle ?? 0) - Math.PI / 2) > 0.5, `bar rotated (angle ${(bar.angle ?? 0).toFixed(2)})`);

  // Bar confinement: try to drag it into the other half.
  await moveTo(page, { x: 900, y: 120 });
  await wait(600);
  const bar2 = (await world()).blockers.find((b) => b.id === "t0-b0")!;
  check(bar2.pos.x <= 600 + 1e-6, `bar stays in its half (x ${bar2.pos.x.toFixed(1)})`);
  await shot("02-bar-moved");

  // Far goalie: select piece 4 and pull it to the top of its box (it gets clamped).
  await page.keyboard.press("4");
  await moveTo(page, { x: 1100, y: 0 });
  await wait(600);
  const g1 = (await world()).goalies.find((g) => g.id === "t1-goalie")!;
  check(g1.pos.y < 230 && g1.pos.x >= 1090, `far goalie clamped to its box (${g1.pos.x.toFixed(0)}, ${g1.pos.y.toFixed(0)})`);

  // Shooter: select piece 1, put the pointer level with the goal, then slingshot leftwards.
  await page.keyboard.press("1");
  await moveTo(page, { x: 600, y: 300 });
  await wait(500);
  await page.mouse.down();
  await moveTo(page, { x: 380, y: 300 }, 15);
  await wait(150);
  await shot("03-aiming");
  await page.mouse.up();
  await wait(120);
  await shot("04-in-flight");
  const speed = Number(await page.evaluate(() => document.body.dataset.puckSpeed));
  check(speed > 500, `puck launched (speed ${speed})`);

  await page.waitForFunction(() => document.body.dataset.score === "1-0", undefined, { timeout: 4000 }).catch(() => {});
  const w1 = await world();
  check(w1.score[0] === 1 && w1.score[1] === 0, `goal scored (score ${w1.score.join("-")})`);
  check(w1.puck.heldBy === 1, "conceding goalie got the puck");
  await shot("05-after-goal");

  // Debug overlay + a bank-shot preview from the team 1 goalie.
  await page.keyboard.press("F3");
  await page.keyboard.press("4");
  await moveTo(page, { x: 1000, y: 300 });
  await wait(400);
  await page.mouse.down();
  await moveTo(page, { x: 1140, y: 150 }, 15);
  await wait(150);
  await shot("06-bank-preview-debug");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await wait(100);
  check((await world()).puck.heldBy === 1, "Esc cancels the shot");

  // Debug contact normals: shoot the bank shot and capture it just after the bounce.
  await moveTo(page, { x: 1000, y: 300 });
  await wait(400);
  await page.mouse.down();
  await moveTo(page, { x: 1140, y: 150 }, 15);
  await page.mouse.up();
  await wait(420);
  await shot("07-bank-shot-debug");
  check((await world()).puck.heldBy === null, "bank shot launched");

  // Tuning panel opens and edits a knob live.
  await page.keyboard.press("t");
  const slider = page.locator("#tuning label", { hasText: "bar.length" }).locator("input");
  await slider.fill("250");
  await wait(100);
  await shot("08-tuning");
  const len = await page.locator("#tuning label", { hasText: "bar.length" }).locator(".value").textContent();
  check(len === "250", `tuning panel changed bar.length (${len})`);
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
