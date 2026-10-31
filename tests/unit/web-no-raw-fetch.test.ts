import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// Repo rule: components talk to the Control API only through the generated SDK (lib/api/domains), never with fetch().
const SRC = fileURLToPath(new URL("../../apps/web/src", import.meta.url));
const RAW_FETCH = /(^|[^\w.])fetch\(/;
// Reverse geocoding goes from the browser straight to BigDataCloud by design; it never reaches the Control API.
const EXTERNAL = new Set(["features/settings/reverseLocation.ts"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

it("keeps fetch() out of components and pages", () => {
  const offenders = [join(SRC, "features"), join(SRC, "app")]
    .flatMap(sources)
    .filter((file) => readFileSync(file, "utf8").split("\n").some((line) => RAW_FETCH.test(line) && !line.trimStart().startsWith("//")))
    .map((file) => relative(SRC, file).replace(/\\/g, "/"))
    .filter((file) => !EXTERNAL.has(file));
  expect(offenders).toEqual([]);
});
