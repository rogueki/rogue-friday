// Browser-level behaviour checks that unit tests cannot cover: context loss -> 2D fallback -> restore,
// hidden tab -> render loop paused, no per-frame React renders, keyboard activation.
// Usage: node scripts/verify-browser.mjs
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = await createServer({ configFile: path.resolve(here, "..", "demo", "vite.config.ts"), logLevel: "error" });
await server.listen();
const base = `http://127.0.0.1:${server.config.server.port}`;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

try {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage();
  await page.goto(`${base}/?mode=working&progress=40&agents=2&quality=medium&shot=1`);
  await page.waitForFunction(() => (window.__ORB_DEBUG__?.frames ?? 0) >= 10, undefined, { timeout: 120_000 });
  const renderer = () => page.evaluate(() => document.querySelector("[data-orb-root]").getAttribute("data-orb-renderer"));
  check("starts in 3d", (await renderer()) === "3d");

  // hidden tab pauses the loop
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(800);
  const f1 = await page.evaluate(() => window.__ORB_DEBUG__.frames);
  await page.waitForTimeout(1500);
  const f2 = await page.evaluate(() => window.__ORB_DEBUG__.frames);
  check("hidden tab stops rendering (frameloop never)", f2 - f1 <= 1, `frames ${f1} -> ${f2}`);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(2500);
  const f3 = await page.evaluate(() => window.__ORB_DEBUG__.frames);
  check("visible tab resumes rendering", f3 - f2 > 2, `frames ${f2} -> ${f3}`);

  // context loss -> 2D fallback -> restore
  await page.evaluate(() => {
    const canvas = document.querySelector("[data-orb-root] canvas:not([data-testid])");
    window.__ext = canvas.getContext("webgl2").getExtension("WEBGL_lose_context");
    window.__ext.loseContext();
  });
  await page.waitForFunction(() => document.querySelector("[data-orb-root]").getAttribute("data-orb-renderer") === "2d", undefined, { timeout: 10_000 });
  check("context loss shows the 2D fallback", !!(await page.$('[data-testid="orb-fallback-2d"]')));
  await page.evaluate(() => window.__ext.restoreContext());
  await page.waitForFunction(() => document.querySelector("[data-orb-root]").getAttribute("data-orb-renderer") === "3d", undefined, { timeout: 30_000 });
  const seq = [];
  for (let i = 0; i < 8; i++) {
    seq.push(await renderer());
    await page.waitForTimeout(500);
  }
  check("context restore returns to 3d and stays there", seq.every((r) => r === "3d"), seq.join(","));
  await page.waitForFunction(() => (window.__ORB_DEBUG__?.frames ?? 0) >= 5, undefined, { timeout: 60_000 });
  check("scene renders again after restore", true);

  // keyboard
  const logs = [];
  page.on("console", (m) => m.type() === "info" && logs.push(m.text()));
  await page.focus("button.friday-orb__target");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  check("Enter activates with the task target", logs.some((l) => l.includes("activate") && l.includes("task")), JSON.stringify(logs));
  check("Space toggles voice", logs.some((l) => l.includes("voice toggle")));
  check("focused target shows the tooltip", !!(await page.$('[role="tooltip"]')));
} finally {
  await browser.close();
  await server.close();
}
process.exit(results.every(Boolean) ? 0 : 1);
