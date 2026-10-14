// Copies the current contract sources into baseline/ (run after a release / intentional major bump).
import fs from "node:fs";
import path from "node:path";
import { paths } from "./lib/contract.mjs";

fs.rmSync(paths.baseline, { recursive: true, force: true });
fs.mkdirSync(paths.baseline, { recursive: true });
for (const dir of ["openapi", "asyncapi", "schemas"]) {
  fs.cpSync(path.join(paths.root, dir), path.join(paths.baseline, dir), { recursive: true });
}
console.log("baseline: updated from current contract");
