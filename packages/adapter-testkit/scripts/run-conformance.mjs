// Runs the conformance suite of every adapter package: discovers adapters/*/test/conformance.test.ts
// (or adapters/*/conformance.test.ts) and hands them to Vitest with the repository's root configuration.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const adaptersDir = join(root, "adapters");

const candidates = ["test/conformance.test.ts", "conformance.test.ts"];
const files = readdirSync(adaptersDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    const found = candidates.map((c) => join(adaptersDir, entry.name, c)).find((p) => existsSync(p));
    return found ? [relative(root, found).replaceAll("\\", "/")] : [];
  })
  .sort();

if (files.length === 0) {
  console.error("Keine Adapter mit conformance.test.ts unter adapters/ gefunden.");
  process.exit(1);
}

console.log(`Conformance-Suite fuer ${files.length} Adapter:\n  ${files.join("\n  ")}\n`);

const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run", "--root", root, ...files], {
  stdio: "inherit",
  cwd: root,
});
process.exit(result.status ?? 1);
