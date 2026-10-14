import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Workspace packages that ship their own vitest.config.* run as their own project. Every other package is covered
// by the shared "node" (ts/mjs tests) and "dom" (tsx tests, jsdom) projects below, which skip the self-configured ones.
const GROUPS = ["packages", "adapters", "apps"] as const;
const CONFIG_NAMES = ["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs"];

const workspaceDirs = GROUPS.flatMap((group) =>
  existsSync(resolve(import.meta.dirname, group))
    ? readdirSync(resolve(import.meta.dirname, group), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${group}/${entry.name}`)
    : [],
);
const selfConfigured = workspaceDirs.filter((dir) =>
  CONFIG_NAMES.some((name) => existsSync(resolve(import.meta.dirname, dir, name))),
);
const skipSelfConfigured = selfConfigured.map((dir) => `${dir}/**`);

const roots = GROUPS.join(",");
const common = { exclude: ["**/node_modules/**", "**/dist/**", "**/out/**", ...skipSelfConfigured] };

export default defineConfig({
  test: {
    projects: [
      ...selfConfigured,
      {
        test: {
          name: "node",
          environment: "node",
          include: [`{${roots}}/*/{src,test}/**/*.test.{ts,mts,mjs}`, "tests/unit/**/*.test.ts"],
          ...common,
          exclude: [...common.exclude, "**/*.dom.test.*"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          include: [`{${roots}}/*/{src,test}/**/*.test.tsx`, `{${roots}}/*/{src,test}/**/*.dom.test.ts`],
          setupFiles: ["tests/setup/dom.ts"],
          ...common,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [`{${roots}}/*/src/**`],
      exclude: ["**/generated/**", "**/*.test.*", "**/*.stories.*"],
    },
  },
});
