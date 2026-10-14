import { defineConfig } from "tsup";

// Workspace packages export TypeScript source, so they are bundled; real dependencies stay external (node_modules).
export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^@jarvis\//],
  external: ["node:sqlite"],
  banner: {
    // Bundled CJS dependencies (ws, fastify plugins) use require/__dirname inside an ESM bundle.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
