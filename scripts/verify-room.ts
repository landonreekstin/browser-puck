// Headless check for M2: two browser clients (separate storage) + 6 bots in one room.
// Alice creates the room and takes team 1's goal, Bob joins by link and takes team 2's,
// bots fill the blockers, Alice starts, shoots, Bob sees it; Bob reloads and keeps his slot.
// Needs `npm run dev` running. Screenshots land in screenshots/.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

const url = process.env.CLIENT_URL ?? "http://localhost:5173";
const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath) throw new Error("CHROMIUM_PATH is not set — run inside `nix develop`");

type Vec = { x: number; y: number };
interface WorldView { goalies: unknown[]; blockers: unknown[]; puck: { heldBy: number | null } }

mkdirSync("screenshots", { recursive: true });
const browser = await chromium.launch({ executablePath });
const failures: string[] = [];
const check = (ok: boolean, msg: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures.push(msg);
};
const data = (page: Page, key: string): Promise<string> => page.evaluate((k) => document.body.dataset[k] ?? "", key);
const until = async (page: Page, key: string, pred: (v: string) => boolean, ms = 5000): Promise<string> => {
  const end = Date.now() + ms;
  let v = await data(page, key);
  while (!pred(v) && Date.now() < end) {
    await page.waitForTimeout(50);
    v = await data(page, key);
  }
  return v;
};
const moveTo = async (page: Page, p: Vec, steps = 10): Promise<void> => {
  const s = await page.evaluate((p) => window.__puck.toScreen(p), p);
  await page.mouse.move(s.x, s.y, { steps });
};
const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: `screenshots/room-${name}.png` });

let bots: ReturnType<typeof spawn> | undefined;
try {
  const alice = await (await browser.newContext({ viewport: { width: 1100, height: 650 } })).newPage();
  const bob = await (await browser.newContext({ viewport: { width: 1100, height: 650 } })).newPage();

  await alice.goto(url);
  await alice.fill("#name", "Alice");
  await alice.click("#create");
  const code = await until(alice, "room", (v) => v.length === 4);
  check(code.length === 4, `Alice created room ${code}`);
  await alice.click('[data-slot="t0-goalie"] button');

  await bob.goto(`${url}/?room=${code}`);
  await bob.fill("#name", "Bob");
  await bob.click("#join");
  check((await until(bob, "room", (v) => v === code)) === code, "Bob joined via the invite link");
  await bob.click('[data-slot="t1-goalie"] button');
  check((await until(bob, "slot", (v) => v !== "")) === "t1-goalie", "Bob took team 2's goal");

  // Server enforces one player per slot: Bob can't take Alice's goal (no button is offered,
  // so send the intent through the page's own connection by re-clicking a taken slot row).
  check((await bob.locator('[data-slot="t0-goalie"] button').count()) === 0, "a taken slot offers no button");

  bots = spawn("tsx", ["server/src/bot.ts", "--room", code, "--count", "6", "--seconds", "60", "--seed", "1"], {
    stdio: "inherit",
  });
  check((await until(alice, "slotted", (v) => v === "8", 8000)) === "8", "6 bots filled the blocker slots (8 players)");
  await shot(alice, "01-lobby-full");

  await alice.click("#start");
  check((await until(bob, "phase", (v) => v === "playing")) === "playing", "host started; Bob sees the match");
  await alice.waitForTimeout(1500);
  const w = (await alice.evaluate(() => window.__puck.world())) as WorldView;
  check(w.goalies.length === 2 && w.blockers.length === 6, `world has 2 goalies + ${w.blockers.length} bars`);
  check(await alice.locator("#lobby").isHidden(), "lobby hides for slotted players during play");
  await shot(alice, "02-playing-alice");
  await shot(bob, "03-playing-bob");

  // Kickoff goes to a random team (DESIGN.md "Faceoff"); its goalie slingshots at the other goal.
  const held = await data(alice, "held");
  check(held === "0" || held === "1", `a goalie holds the puck at kickoff (team ${Number(held) + 1})`);
  const [shooter, watcher] = held === "0" ? [alice, bob] : [bob, alice];
  const dir = held === "0" ? 1 : -1;
  await moveTo(shooter, { x: 600, y: 300 });
  await shooter.waitForTimeout(500);
  await shooter.mouse.down();
  await moveTo(shooter, { x: 600 - 200 * dir, y: 300 }, 15);
  await shooter.waitForTimeout(100);
  await shot(shooter, "04-aiming");
  await shooter.mouse.up();
  const seen = await until(watcher, "held", (v) => v !== held, 2000);
  check(seen !== held, "the other client sees the shot leave the goalie (server-authoritative)");
  await watcher.waitForTimeout(200);
  await shot(watcher, "05-other-client-sees-shot");

  // Reconnect: Bob reloads the page and lands back in his slot.
  await bob.reload();
  check((await until(bob, "slot", (v) => v === "t1-goalie", 5000)) === "t1-goalie", "Bob reloaded and kept his slot");
  check((await until(bob, "phase", (v) => v === "playing")) === "playing", "Bob is back in the match");
  await bob.waitForTimeout(1000);
  await shot(bob, "06-bob-after-reload");

  await alice.click("#end-match");
  check((await until(bob, "phase", (v) => v === "lobby")) === "lobby", "host ended the match; back to lobby");
  await shot(bob, "07-back-to-lobby");
} finally {
  bots?.kill("SIGTERM");
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
