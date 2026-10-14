import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: [resolve(import.meta.dirname, "../../tests/setup/dom.ts"), resolve(import.meta.dirname, "src/test/setup.ts")],
    css: false,
  },
});
