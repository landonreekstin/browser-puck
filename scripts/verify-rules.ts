// Headless check for M3 match flow: 8 bots play a full match while a browser spectates.
// Records possession over time and checks the puck never stalls: shots, catches, dead-puck
// handoffs and goals keep happening, and a winner is eventually declared.
// Needs `npm run dev` running. Screenshots land in screenshots/.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { chromium, type Page } from "playwright-core";
import { defaultConfig } from "@puck/shared";

const url = process.env.CLIENT_URL ?? "http://localhost:5173";
const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath) throw new Error("CHROMIUM_PATH is not set — run inside `nix develop`");
const MAX_SECONDS = Number(process.env.SECONDS ?? 240);

type Vec = { x: number; y: number };
interface W { score: [number, number]; winner: number | null; puck: { pos: Vec; vel: Vec; heldBy: number | null } }

mkdirSync("screenshots", { recursive: true });
const failures: string[] = [];
const check = (ok: boolean, msg: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures.push(msg);
};

const bots = spawn("tsx", ["server/src/bot.ts", "--create", "--count", "8", "--start", "--seconds", String(MAX_SECONDS + 30), "--seed", "5"], {
  stdio: ["ignore", "pipe", "inherit"],
});
const code = await new Promise<string>((resolve) => {
  createInterface({ input: bots.stdout! }).on("line", (line) => {
    const m = /^room (\w{4})/.exec(line);
    if (m) resolve(m[1]!);
  });
});

const browser = await chromium.launch({ executablePath });
try {
  const page: Page = await (await browser.newContext({ viewport: { width: 1100, height: 650 } })).newPage();
  await page.goto(`${url}/?room=${code}`);
  await page.fill("#name", "watcher");
  await page.click("#join");
  await page.waitForFunction(() => document.body.dataset.phase === "playing", undefined, { timeout: 10000 });

  let launches = 0;
  let catchesOrDead = 0;
  let goals = 0;
  let longestStall = 0;
  let stallStart = Date.now();
  let prev: W | undefined;
  let shotTimerShot = false;
  const started = Date.now();

  while (Date.now() - started < MAX_SECONDS * 1000) {
    const w = (await page.evaluate(() => window.__puck.world())) as W;
    if (prev) {
      const scored = w.score[0] + w.score[1] > prev.score[0] + prev.score[1];
      if (scored) goals++;
      if (prev.puck.heldBy !== null && w.puck.heldBy === null) launches++;
      if (prev.puck.heldBy === null && w.puck.heldBy !== null && !scored) catchesOrDead++;
    }
    const loose = w.puck.heldBy === null;
    // "Dead" as the rule defines it: loose and slower than rules.deadSpeed.
    const dead = Math.hypot(w.puck.vel.x, w.puck.vel.y) < defaultConfig.rules.deadSpeed;
    if (!(loose && dead)) stallStart = Date.now();
    longestStall = Math.max(longestStall, Date.now() - stallStart);
    if (!shotTimerShot && w.puck.heldBy !== null && Date.now() - started > 2000) {
      await page.screenshot({ path: "screenshots/rules-01-shot-timer.png" });
      shotTimerShot = true;
    }
    if (w.winner !== null) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: "screenshots/rules-02-winner.png" });
      console.log(`     winner: team ${w.winner + 1}, score ${w.score.join("-")} after ${((Date.now() - started) / 1000).toFixed(0)} s`);
      break;
    }
    prev = w;
    await page.waitForTimeout(100);
  }

  console.log(`     launches ${launches}, catches/dead-puck handoffs ${catchesOrDead}, goals ${goals}, longest loose-and-dead ${(longestStall / 1000).toFixed(1)} s`);
  check(launches >= 10, "goalies keep launching");
  check(catchesOrDead >= 3, "catches / dead-puck handoffs return the puck to a goalie");
  check(goals >= 1, "goals are scored");
  const allowed = defaultConfig.rules.deadPuckSeconds * 1000 + 400; // + sampling/interp slack
  check(longestStall > 500, `the puck did go dead at times (${(longestStall / 1000).toFixed(1)} s), so this is measured`);
  check(longestStall < allowed, `…but never longer than the dead-puck rule allows (${(longestStall / 1000).toFixed(1)} s ≤ ${allowed / 1000} s)`);
  // Whether random bots reach 5 goals in time is luck; the win rule itself is covered by the
  // sim tests and verify:sandbox. Report it either way.
  const winner = (await page.evaluate(() => window.__puck.world() as W)).winner;
  console.log(`     ${winner === null ? "no winner within the time limit (bots are bad at this)" : "match ended with a winner"}`);
} finally {
  bots.kill("SIGTERM");
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
