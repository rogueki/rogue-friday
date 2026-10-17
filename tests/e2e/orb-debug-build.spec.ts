import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { test, expect } from "@playwright/test";

/**
 * The orb lab (debug panel, owner order section 19) is development only. The production export in `apps/web/out` must
 * contain none of its code: not the panel component, not the floating overlay, not their markers. (The dictionary keys
 * of the labels are part of the shared i18n tables and do not count: they are plain strings next to the other
 * dev-console texts.)
 */
const OUT = resolve(import.meta.dirname, "../../apps/web/out");
const FORBIDDEN = ["orb-lab-state", 'data-testid":"orb-lab"', "orb-debug-overlay", "OrbDebugPanel", "setOrbDebugVisuals", "orbDebugStore"];

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|html|txt|json|css)$/.test(entry)) yield path;
  }
}

test.describe("production build", () => {
  test.skip(!existsSync(OUT), "apps/web/out is missing (run pnpm build:app first)");

  test("contains no orb debug panel code", () => {
    const hits: string[] = [];
    let scanned = 0;
    for (const file of files(OUT)) {
      scanned += 1;
      const text = readFileSync(file, "utf8");
      for (const marker of FORBIDDEN) if (text.includes(marker)) hits.push(`${marker} in ${file.slice(OUT.length)}`);
    }
    expect(scanned, "scanned a real build").toBeGreaterThan(20);
    expect(hits).toEqual([]);
  });

  test("the orb controller reaches the main bundle only as types: three.js stays in the lazily loaded orb chunk", () => {
    const entry = [...files(join(OUT, "_next", "static", "chunks"))].filter((file) => /(main-app|webpack|main)-[\w-]+\.js$/.test(file));
    for (const file of entry) expect(readFileSync(file, "utf8"), file.slice(OUT.length)).not.toMatch(/WebGLRenderer/);
  });
});
