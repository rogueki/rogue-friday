import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    name: "web",
    environment: "jsdom",
    // Same budget as the root "dom" project: under the full parallel run jsdom renders of whole pages exceed 5 s.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: [resolve(import.meta.dirname, "../../tests/setup/dom.ts"), resolve(import.meta.dirname, "src/test/setup.ts")],
    css: false,
  },
});
