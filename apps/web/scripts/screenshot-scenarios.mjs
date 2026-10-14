// Scenario screenshots of the overview in standalone mock mode (start `pnpm --filter @jarvis/web dev:mock` first).
//   node scripts/screenshot-scenarios.mjs [--base http://localhost:3000] [--out screenshots/a2] [--only <name-substring>]
// Chromium: PW_CHROMIUM=<path to chrome binary> overrides the Playwright default (the cloud image ships /opt/pw-browsers).
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
const outDir = resolve(root, opt("out", "screenshots/a2"));
const only = opt("only", "");
mkdirSync(outDir, { recursive: true });

const GL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"];
const NO_GL_ARGS = ["--disable-gpu", "--disable-3d-apis", "--disable-webgl", "--disable-webgl2"];
const executablePath = process.env.PW_CHROMIUM || undefined;

const FHD = { width: 1920, height: 1080 };
/** play: scenario id, settle: ms to wait after play (mock clock follows the wall clock). */
const shots = [
  { name: "01-default-1920x1080", viewport: FHD },
  { name: "02-partial-outage-1920x1080", viewport: FHD, play: "partial-outage", settle: 3500 },
  { name: "03-critical-alert-1920x1080", viewport: FHD, play: "critical-alert", settle: 2500 },
  { name: "04-approval-waiting-1920x1080", viewport: FHD, play: "approval-waiting", settle: 2500 },
  { name: "05-empty-new-installation-1920x1080", viewport: FHD, play: "empty-new-installation", settle: 2500 },
  { name: "06-long-german-text-1920x1080", viewport: FHD, play: "long-german-text", settle: 2500 },
  { name: "07-reduced-motion-1920x1080", viewport: FHD, reducedMotion: "reduce" },
  { name: "08-webgl-failure-scenario-1920x1080", viewport: FHD, play: "webgl-failure", settle: 6000 },
  { name: "09-webgl-unavailable-1920x1080", viewport: FHD, noWebgl: true },
  { name: "10-default-2560x1440", viewport: { width: 2560, height: 1440 } },
  { name: "11-default-1440x900", viewport: { width: 1440, height: 900 } },
  { name: "12-default-tablet-1024x768", viewport: { width: 1024, height: 768 } },
  { name: "13-long-german-text-tablet-1024x768", viewport: { width: 1024, height: 768 }, play: "long-german-text", settle: 2500 },
  { name: "14-working-1920x1080", viewport: FHD, play: "multi-agent-working", settle: 3000 },
  { name: "15-listening-1920x1080", viewport: FHD, play: "listening", settle: 2500 },
].filter((shot) => !only || shot.name.includes(only));

let failures = 0;
for (const shot of shots) {
  const browser = await chromium.launch({ headless: true, executablePath, args: shot.noWebgl ? NO_GL_ARGS : GL_ARGS });
  const context = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: 1,
    locale: "de-DE",
    reducedMotion: shot.reducedMotion ?? "no-preference",
  });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__jarvisMock), null, { timeout: 30000 });
  if (shot.play) {
    await page.evaluate(async (id) => {
      await window.__jarvisMock.engine.play(id);
    }, shot.play);
  }
  await page.waitForTimeout(shot.settle ?? 3500);
  const file = join(outDir, `${shot.name}.png`);
  await page.screenshot({ path: file });
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const panel = document.querySelector(".ov-cell--ai-core-orb .jv-panel__frame");
    const canvas = document.querySelector(".ov-orb__stage canvas");
    const orb = document.querySelector("[data-orb-renderer]");
    const rect = (el) => (el ? el.getBoundingClientRect() : null);
    const p = rect(panel);
    const c = rect(canvas);
    return {
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
      renderer: orb?.getAttribute("data-orb-renderer") ?? null,
      panel: p ? { w: Math.round(p.width), h: Math.round(p.height) } : null,
      canvas: c ? { w: Math.round(c.width), h: Math.round(c.height), ofPanelHeight: p ? Number((c.height / p.height).toFixed(2)) : null } : null,
    };
  });
  console.log(`${shot.name}: ${JSON.stringify(metrics)}`);
  for (const problem of problems.slice(0, 6)) console.log(`   ${problem}`);
  if (metrics.horizontalOverflow) failures += 1;
  await browser.close();
}
process.exit(failures > 0 ? 1 : 0);
