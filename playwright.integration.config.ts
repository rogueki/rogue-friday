import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { API_ORIGIN } from "./tests/integration/constants";

// Headless WebGL (the orb) needs SwiftShader; CLAUDE.md "Umgebung". The Chromium path can be overridden for other machines.
const CLOUD_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = process.env.FRIDAY_CHROMIUM ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);

export default defineConfig({
  testDir: "tests/integration",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  outputDir: "test-results/integration",
  use: {
    baseURL: API_ORIGIN,
    viewport: { width: 1600, height: 900 },
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Fake upstreams + built Control API in hybrid mode; needs `pnpm build:app` first.
  webServer: {
    command: "pnpm exec tsx tests/integration/stack.ts",
    url: `${API_ORIGIN}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 90_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
