import { defineConfig } from "@playwright/test";
import { launchOptions } from "./tests/e2e/support/browser";
import { API_ORIGIN } from "./tests/e2e/support/constants";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  // One shared Control API instance whose world state (scenarios, settings) the specs mutate -> strictly serial.
  fullyParallel: false,
  workers: 1,
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
  // Built Control API (mock mode, dev login, snapshot of apps/web/out). Needs `pnpm build:app` once; see tests/e2e/README.md.
  webServer: {
    command: "pnpm exec tsx tests/e2e/stack.ts",
    url: `${API_ORIGIN}/api/v1/health`,
    // JARVIS_E2E_REUSE=1: attach to an already running `pnpm exec tsx tests/e2e/stack.ts` (faster spec development).
    reuseExistingServer: process.env.JARVIS_E2E_REUSE === "1",
    timeout: 600_000, // includes `pnpm build:app` when the build is missing
    stdout: "pipe",
    stderr: "pipe",
  },
});
