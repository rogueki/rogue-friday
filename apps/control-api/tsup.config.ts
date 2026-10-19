import { defineConfig } from "tsup";
import { readFileSync, writeFileSync } from "node:fs";

// Workspace packages export TypeScript source, so they are bundled; real dependencies stay external (node_modules).
export default defineConfig({
  entry: { main: "src/main.ts", "system-recovery": "scripts/system-recovery.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  // ajv is bundled too: `@friday/sdk` imports "ajv/dist/2020" without extension, which Node's ESM resolver rejects.
  noExternal: [/^@friday\//, /^ajv(-formats)?(\/.*)?$/],
  // `msw/browser` is imported dynamically by the browser-only MSW setup of @friday/mock-data and never runs on the server.
  external: ["node:sqlite", "msw/browser"],
  // esbuild drops the `node:` prefix of imports it cannot map to a known builtin; `node:sqlite` only exists prefixed.
  onSuccess: async () => {
    for (const file of ["dist/main.js", "dist/system-recovery.js"]) {
      const code = readFileSync(file, "utf8");
      const fixed = code.replace(/((?:from|import\()\s*)"sqlite"/g, '$1"node:sqlite"');
      if (fixed !== code) writeFileSync(file, fixed);
    }
  },
  banner: {
    // Bundled CJS dependencies (ws, fastify plugins) use require/__dirname inside an ESM bundle.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
