// Screenshots the overview at the four reference viewports with Playwright (chromium) into apps/web/screenshots/.
//   node scripts/screenshot.mjs                       -> http://localhost:3000 (start `pnpm --filter @jarvis/web dev:mock` first)
//   node scripts/screenshot.mjs --base http://127.0.0.1:3100 --path / --only desktop
//   options: --motion reduced|full|off (default reduced), --wait <ms> (settle time, default 2500), --scenario <id>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const base = opt("base", "http://localhost:3000");
const pathname = opt("path", "/");
const only = opt("only", "");
const motion = opt("motion", "reduced");
const settle = Number(opt("wait", "2500"));
const scenario = opt("scenario", "");
const outDir = join(root, "screenshots");
mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: "desktop-1920x1080", width: 1920, height: 1080 },
  { name: "laptop-1440x900", width: 1440, height: 900 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
  // The shell scrolls inside <main>, so "full page" views use a tall viewport instead of fullPage.
  { name: "tablet-1024x768-full", width: 1024, height: 2300 },
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "mobile-390x844-full", width: 390, height: 3000 },
].filter((viewport) => !only || viewport.name.includes(only));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});

let failures = 0;
for (const viewport of viewports) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, locale: "de-DE" });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  await page.addInitScript((mode) => {
    try {
      localStorage.setItem("jarvis.motion", mode);
    } catch {
      // storage unavailable: the app does not depend on it
    }
  }, motion);
  await page.goto(`${base}${pathname}`, { waitUntil: "networkidle" });
  if (motion !== "full") await page.evaluate((mode) => document.documentElement.setAttribute("data-motion", mode), motion);
  if (scenario) {
    await page.evaluate(async (id) => {
      await window.__jarvisMock?.engine?.play?.(id);
    }, scenario);
  }
  await page.waitForTimeout(settle);
  const file = join(outDir, `overview-${viewport.name}${scenario ? `-${scenario}` : ""}.png`);
  await page.screenshot({ path: file });
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { horizontal: doc.scrollWidth > doc.clientWidth + 1, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  console.log(`${viewport.name}: ${file}${overflow.horizontal ? `  HORIZONTAL OVERFLOW ${overflow.scrollWidth} > ${overflow.clientWidth}` : ""}`);
  for (const problem of problems.slice(0, 8)) console.log(`   ${problem}`);
  if (overflow.horizontal) failures += 1;
  await context.close();
}
await browser.close();
process.exit(failures > 0 ? 1 : 0);
