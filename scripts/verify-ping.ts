// Headless check for M0: two browser clients connect to the server and show an RTT.
// Needs `npm run dev` running. Screenshots land in screenshots/.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const url = process.env.CLIENT_URL ?? "http://localhost:5173";
const clients = Number(process.env.CLIENTS ?? 2);
const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath) throw new Error("CHROMIUM_PATH is not set — run inside `nix develop`");

mkdirSync("screenshots", { recursive: true });
const browser = await chromium.launch({ executablePath });
let failed = false;

try {
  const pages = await Promise.all(
    Array.from({ length: clients }, async () => {
      const page = await browser.newPage({ viewport: { width: 480, height: 120 } });
      await page.goto(url);
      return page;
    }),
  );

  for (const [i, page] of pages.entries()) {
    try {
      await page.waitForFunction(() => document.body.dataset.rtt, undefined, { timeout: 5000 });
      const rtt = await page.evaluate(() => document.body.dataset.rtt);
      console.log(`client ${i}: connected, RTT ${rtt} ms`);
    } catch {
      const status = await page.evaluate(() => document.body.dataset.status);
      console.error(`client ${i}: no RTT (status: ${status ?? "unknown"})`);
      failed = true;
    }
    const path = `screenshots/ping-client-${i}.png`;
    await page.screenshot({ path });
    console.log(`  screenshot: ${path}`);
  }
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
