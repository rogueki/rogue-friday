import { defineConfig, type Options } from "tsup";
import { readFileSync, writeFileSync } from "node:fs";

/** Options shared by the shipped server and the e2e server bundle (`tsup.e2e.config.ts`). */
export function serverBundle(entry: Record<string, string>, outDir: string, external: string[] = []): Options {
  return {
    entry,
    format: ["esm"],
    platform: "node",
    target: "node22",
    outDir,
    clean: true,
    sourcemap: true,
    splitting: false,
    // ajv is bundled too: `@friday/sdk` imports "ajv/dist/2020" without extension, which Node's ESM resolver rejects.
    noExternal: [/^@friday\//, /^ajv(-formats)?(\/.*)?$/],
    external: ["node:sqlite", ...external],
    // esbuild drops the `node:` prefix of imports it cannot map to a known builtin; `node:sqlite` only exists prefixed.
    onSuccess: async () => {
      for (const name of Object.keys(entry)) {
        const file = `${outDir}/${name}.js`;
        const code = readFileSync(file, "utf8");
        const fixed = code.replace(/((?:from|import\()\s*)"sqlite"/g, '$1"node:sqlite"');
        if (fixed !== code) writeFileSync(file, fixed);
      }
    },
    banner: {
      // Bundled CJS dependencies (ws, fastify plugins) use require/__dirname inside an ESM bundle.
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  };
}

// Workspace packages export TypeScript source, so they are bundled; real dependencies stay external (node_modules).
export default defineConfig(serverBundle({ main: "src/main.ts", "system-recovery": "scripts/system-recovery.ts" }, "dist"));
