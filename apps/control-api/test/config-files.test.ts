import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { loadConfig } from "@friday/config";
import { createLogger } from "@friday/observability";
import { createSchemaValidator } from "@friday/sdk";
import { openDatabase } from "../src/db/database";
import { LibraryStore } from "../src/db/stores";
import { normalizeLayout, normalizeTheme, seedLibrary } from "../src/services/settings";

const CONFIG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../config");
const validator = createSchemaValidator();

const jsonFiles = (folder: string): string[] =>
  readdirSync(join(CONFIG_DIR, folder))
    .filter((name) => name.endsWith(".json") && !name.endsWith(".schema.json"))
    .sort();
const read = (folder: string, name: string): unknown => JSON.parse(readFileSync(join(CONFIG_DIR, folder, name), "utf8").replace(/^\uFEFF/, "")) as unknown;

describe("shipped config files validate against their schemas", () => {
  it("finds the shipped layouts and themes", () => {
    expect(jsonFiles("layouts").length).toBeGreaterThanOrEqual(1);
    expect(jsonFiles("themes").length).toBeGreaterThanOrEqual(2);
  });

  describe("config/layouts/*.json against the Layout contract schema", () => {
    for (const name of jsonFiles("layouts")) {
      it(name, () => {
        const layout = read("layouts", name);
        const result = validator.validate("Layout", layout);
        expect(result.errors, `${name} verletzt das Layout-Schema`).toEqual([]);
        expect(result.valid).toBe(true);
        expect(normalizeLayout(layout, validator), "normalizeLayout akzeptiert die Datei unverändert").toEqual(layout);
      });
    }
  });

  describe("config/themes/*.json against config/themes/theme.schema.json and the Theme contract schema", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    (typeof addFormats === "function" ? addFormats : (addFormats as unknown as { default: typeof addFormats }).default)(ajv);
    const themeSchema = JSON.parse(readFileSync(join(CONFIG_DIR, "themes", "theme.schema.json"), "utf8")) as object;
    const validate = ajv.compile(themeSchema);

    for (const name of jsonFiles("themes")) {
      it(name, () => {
        const theme = read("themes", name);
        expect(validate(theme), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
        const normalized = normalizeTheme(theme, validator);
        expect(normalized, "normalizeTheme akzeptiert die Datei").not.toBeNull();
        expect(validator.validate("Theme", normalized).errors).toEqual([]);
        // normalizing must not silently drop tokens
        expect(Object.keys(normalized?.tokens ?? {}).sort()).toEqual(Object.keys((theme as { tokens: object }).tokens).sort());
      });
    }
  });

  it("seeds all of them at startup without a single warning (no 'Layout-Datei ist ungültig')", () => {
    expect(existsSync(join(CONFIG_DIR, "layouts"))).toBe(true);
    const lines: string[] = [];
    const logger = createLogger({ service: "control-api", level: "debug", stdout: false, sinks: [{ write: (line: string) => void lines.push(line) }] });
    const config = loadConfig({ configDir: CONFIG_DIR, cwd: dirname(CONFIG_DIR), env: {} });
    const library = new LibraryStore(openDatabase(":memory:"));
    seedLibrary(library, config, validator, logger);
    const problems = lines.map((line) => JSON.parse(line) as { level: string; message: string }).filter((entry) => entry.level === "warn" || entry.level === "error");
    expect(problems).toEqual([]);
    expect(library.list("layout").map((layout) => (layout as { layoutId: string }).layoutId)).toContain("friday-command-overview");
    expect(library.list("theme").length).toBeGreaterThanOrEqual(2);
  });
});
