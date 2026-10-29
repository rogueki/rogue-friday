import { defineConfig } from "@playwright/test";
import { launchOptions, NO_GL_ARGS } from "./tests/e2e/support/browser";
import { API_ORIGIN } from "./tests/e2e/support/constants";

// Specs that render the WebGL orb or compare screenshots keep SwiftShader; the rest run with the 2D fallback, which
// avoids the SwiftShader GPU-process stalls that caused most CI retries (N-093).
const WEBGL_SPECS = [/orb-[^/]*\.spec\.ts$/, /visual\.spec\.ts$/, /mobile\.spec\.ts$/, /a11y\.spec\.ts$/,
  /performance\.spec\.ts$/, /settings\.spec\.ts$/, /fallback-2d\.spec\.ts$/];
// The high-load block of performance.spec.ts measures the activity feed, kanban and reconnect, never the orb; under
// SwiftShader it hit the same context-setup stalls, so it runs with the 2D fallback like the other non-orb specs.
const HIGH_LOAD = /high load \(profile highLoad/;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  // Each CI shard owns an isolated Control API; one worker keeps each shard's mutable world strictly serial.
  fullyParallel: true,
  workers: 1,
  retries: process.env.CI ? 1 : 0, // Recover once from transient Chromium context setup/teardown stalls on CI runners.
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide", scale: "css" },
  },
  reporter: [["list"]],
  outputDir: "test-results/e2e",
  // Baselines are per platform: fonts/anti-aliasing differ between Linux and Windows. Regenerate with `pnpm test:e2e:update`.
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}",
  use: {
    baseURL: API_ORIGIN,
    viewport: { width: 1920, height: 1080 },
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    colorScheme: "dark",
    launchOptions: launchOptions(),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "webgl", testMatch: WEBGL_SPECS, grepInvert: HIGH_LOAD, use: { launchOptions: launchOptions() } },
    { name: "2d-load", testMatch: /performance\.spec\.ts$/, grep: HIGH_LOAD, use: { launchOptions: launchOptions(NO_GL_ARGS) } },
    { name: "2d", testMatch: "**/*.spec.ts", testIgnore: WEBGL_SPECS, use: { launchOptions: launchOptions(NO_GL_ARGS) } },
  ],
  // Built Control API (mock mode, dev login, snapshot of apps/web/out). Needs `pnpm build:app` once; see tests/e2e/README.md.
  webServer: {
    command: "pnpm exec tsx tests/e2e/stack.ts",
    url: `${API_ORIGIN}/api/v1/health`,
    // FRIDAY_E2E_REUSE=1: attach to an already running `pnpm exec tsx tests/e2e/stack.ts` (faster spec development).
    reuseExistingServer: process.env.FRIDAY_E2E_REUSE === "1",
    timeout: 600_000, // includes `pnpm build:app` when the build is missing
    stdout: "pipe",
    stderr: "pipe",
  },
});
