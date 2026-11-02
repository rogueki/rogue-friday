import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Started from this folder (`pnpm --filter @friday/control-api test`, an editor, `npx vitest`) the root config and its
// setup never ran: test runtimes inherited the host's FRIDAY_OBSIDIAN_VAULT and wrote thousands of test notes into the
// owner's real Obsidian vault (2026-10-28..11-02). This config carries the same isolation wherever vitest starts.
export default defineConfig({
  test: {
    name: "control-api",
    environment: "node",
    // Same budget as the root "node" project: route sweeps start a real API server per test file.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: ["{src,test}/**/*.test.{ts,mts,mjs}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.dom.test.*"],
    setupFiles: [resolve(import.meta.dirname, "../../tests/setup/node.ts")],
  },
});
