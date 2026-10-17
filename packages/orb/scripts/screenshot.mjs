// Deterministic orb screenshots + frame-time measurement.
// Usage: node scripts/screenshot.mjs [--only=idle,error] [--dsf=2] [--quality=high] [--perf] [--out=<dir>]
// Env: ORB_CHROMIUM = path of a Chromium/Chrome binary (default: Playwright's own).
// Starts the demo (Vite) itself, renders every mode on the fixed test clock and writes PNGs to ../screenshots.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultOut = path.resolve(here, "..", "screenshots");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);
const only = args.only ? new Set(args.only.split(",")) : null;
const outArg = args.out ? path.resolve(args.out) : null;
const dsf = Number(args.dsf ?? 2);
const quality = args.quality ?? "high";
const T = "t=12.5";
const common = `shot=1&quality=${quality}&${T}`;

/** name -> query. Every mode, plus the stories' variants (reduced motion, low quality, 2D fallback). */
const SHOTS = [
  ["idle", `mode=idle&${common}`],
  ["idle-t2", `mode=idle&shot=1&quality=${quality}&t=31.7`],
  ["booting", `mode=booting&${common}&ap=0.62`],
  ["listening-low", `mode=listening&audio=0.15&${common}`],
  ["listening-high", `mode=listening&audio=0.9&${common}`],
  ["transcribing", `mode=transcribing&${common}`],
  ["thinking", `mode=thinking&${common}`],
  ["syncing", `mode=syncing&${common}`],
  ["working-indeterminate", `mode=working&agents=2&indeterminate=1&${common}`],
  ["working-62-3agents", `mode=working&progress=62&agents=3&${common}`],
  ["speaking", `mode=speaking&audio=0.6&${common}`],
  ["speaking-3agents-working", `mode=parallel&progress=62&agents=3&audio=0.6&${common}`],
  ["waiting-approval", `mode=waiting_approval&${common}`],
  ["approval-while-speaking", `scene=approvalSpeaking&audio=0.6&${common}`],
  ["success", `mode=success&${common}&ap=0.35`],
  ["warning", `mode=warning&${common}`],
  ["error", `mode=error&${common}&ap=0.7`],
  ["offline", `mode=offline&${common}`],
  ["paused", `mode=paused&${common}`],
  ["reduced-motion", `mode=working&progress=62&agents=3&anim=reduced&${common}`],
  ["low-quality", `mode=working&progress=62&agents=3&shot=1&quality=low&${T}`],
  ["fallback-2d", `mode=working&progress=62&agents=3&renderer=2d&${common}`],
  ["fallback-2d-speaking", `mode=parallel&progress=62&agents=3&audio=0.6&renderer=2d&${common}`],
  ["fallback-2d-thinking", `mode=thinking&renderer=2d&${common}`],
  ["reduced-motion-speaking", `mode=parallel&audio=0.6&anim=reduced&${common}`],
  ["idle-large", `mode=idle&size=large&${common}`],
  ["listening-high-large", `mode=listening&audio=1&size=large&${common}`],
  ["speaking-large", `mode=speaking&audio=1&size=large&${common}`],
  ["working-large", `mode=working&progress=62&agents=3&size=large&${common}`],
];

async function main() {
  const outDir = outArg ?? defaultOut;
  await mkdir(outDir, { recursive: true });
  const server = await createServer({ configFile: path.resolve(here, "..", "demo", "vite.config.ts"), logLevel: "error" });
  await server.listen();
  const base = `http://127.0.0.1:${server.config.server.port}`;
  const browser = await chromium.launch({
    ...(process.env.ORB_CHROMIUM ? { executablePath: process.env.ORB_CHROMIUM } : {}),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", "--use-gl=angle", ...(process.env.ORB_CHROMIUM ? ["--no-sandbox"] : [])],
  });
  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: dsf });
    for (const [name, query] of SHOTS) {
      if (only && !only.has(name)) continue;
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      const started = Date.now();
      await page.goto(`${base}/?${query}`, { waitUntil: "load" });
      await page.waitForFunction(
        () => {
          const root = document.querySelector("[data-orb-root]");
          if (!root) return false;
          if (root.getAttribute("data-orb-renderer") === "2d" && root.getAttribute("data-orb-webgl") !== "unknown") {
            return !!document.querySelector('[data-testid="orb-fallback-2d"]');
          }
          return (window.__ORB_DEBUG__?.frames ?? 0) >= 8;
        },
        undefined,
        { timeout: 180_000 },
      );
      await page.waitForTimeout(500);
      const panel = page.locator('[data-testid="orb-panel"]');
      const file = path.join(outDir, `${name}.png`);
      await panel.screenshot({ path: file });
      const info = await page.evaluate(() => ({
        renderer: document.querySelector("[data-orb-root]")?.getAttribute("data-orb-renderer"),
        quality: document.querySelector("[data-orb-root]")?.getAttribute("data-orb-quality"),
        label: document.querySelector('[data-testid="orb-state-label"]')?.textContent,
      }));
      results.push({ name, ms: Date.now() - started, errors, ...info });
      console.log(`${name.padEnd(28)} ${String(Date.now() - started).padStart(6)} ms  ${info.renderer}/${info.quality}  "${info.label}"${errors.length ? "  ERRORS: " + errors.join(" | ") : ""}`);
      await page.close();
    }

    if (args.perf || !only) {
      // Real-time frame-time measurement at high quality (no fixed clock, auto quality disabled by explicit level).
      const page = await context.newPage();
      await page.goto(`${base}/?mode=working&progress=62&agents=3&quality=${quality}&shot=1`, { waitUntil: "load" });
      await page.waitForFunction(() => (window.__ORB_DEBUG__?.frames ?? 0) >= 20, undefined, { timeout: 180_000 });
      await page.waitForTimeout(6000);
      const perf = await page.evaluate(() => {
        const p = window.__ORB_DEBUG__;
        return p ? { frames: p.frames, avgFrameMs: p.avgFrameMs, p95FrameMs: p.p95FrameMs, draws: p.draws, triangles: p.triangles, geometries: p.geometries, textures: p.textures, segments: p.segments, quality: p.quality } : null;
      });
      console.log("PERF (SwiftShader, software GL)", JSON.stringify(perf));
      await writeFile(path.join(outDir, "perf.json"), JSON.stringify({ renderer: "SwiftShader (software)", dsf, ...perf }, null, 2));
      await page.close();
    }
    await writeFile(path.join(outDir, "report.json"), JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
