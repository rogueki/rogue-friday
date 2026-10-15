import { applyTheme, defaultTheme } from "@friday/design-tokens";
import type { Layout } from "@friday/sdk";
import { describe, expect, it } from "vitest";
import { validateContract } from "./jsonSchemaValidate";
import { fieldKind, jsonEqual, secretPropertyNames, stripSecrets, validateConfig, type FieldSchema } from "./schemaLogic";
import {
  addWidget,
  layoutOverlaps,
  moveItem,
  moveWidget,
  normalizeNavOrder,
  parseLayoutImport,
  parseSettingsImport,
  parseThemeImport,
  resizeWidget,
  slugify,
  updateWidget,
} from "./settingsLogic";
import { LAYOUTS, THEMES } from "./testApi";

describe("navigation order", () => {
  it("moves an item and clamps the target", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("keeps the stored order, drops unknown ids and appends missing pages", () => {
    expect(normalizeNavOrder(["tasks", "ghost", "overview", "tasks"], ["overview", "tasks", "memory"])).toEqual(["tasks", "overview", "memory"]);
  });
});

describe("layout operations", () => {
  const layout: Layout = LAYOUTS[0] as Layout;

  it("moves and resizes inside the grid", () => {
    expect(moveWidget(layout, "ai-core-orb", 1, 2).widgets.find((w) => w.id === "ai-core-orb")).toMatchObject({ x: 4, y: 2 });
    // would leave the 12 columns: clamped, never invalid
    expect(moveWidget(layout, "attention-feed", 5, -3).widgets.find((w) => w.id === "attention-feed")).toMatchObject({ x: 9, y: 0 });
    expect(resizeWidget(layout, "core-overview", -9, 1).widgets.find((w) => w.id === "core-overview")).toMatchObject({ w: 1, h: 8 });
  });

  it("toggles visibility, adds a missing widget below everything and detects overlaps", () => {
    const hidden = updateWidget(layout, "core-overview", { visible: false });
    expect(hidden.widgets[0]?.visible).toBe(false);
    const added = addWidget(layout, "system-monitor");
    expect(added.widgets.find((w) => w.id === "system-monitor")).toMatchObject({ x: 0, y: 7, visible: true });
    expect(layoutOverlaps(layout)).toEqual([]);
    expect(layoutOverlaps(moveWidget(layout, "ai-core-orb", -2, 0))).toEqual([["core-overview", "ai-core-orb"]]);
  });

  it("slugifies names for layout ids", () => {
    expect(slugify("Mein Größtes Layout!")).toBe("mein-grosstes-layout");
  });
});

describe("theme import (PLAN §25.5)", () => {
  const valid = JSON.stringify({ ...THEMES[0], builtIn: undefined, id: "mein-theme", name: "Mein Theme" });

  it("accepts a schema-valid theme and marks it as not built in", () => {
    const result = parseThemeImport(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ id: "mein-theme", builtIn: false });
  });

  it("rejects invalid JSON", () => {
    const result = parseThemeImport("{ kaputt");
    expect(result.ok).toBe(false);
  });

  it("rejects a theme that violates the JSON schema", () => {
    const broken = JSON.stringify({ id: "Kaputt Id", name: "x", tokens: "nope", orb: {}, panels: {} });
    const result = parseThemeImport(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/id|tokens|Pflichtfeld/);
  });

  it("rejects colour values the design tokens cannot render", () => {
    const badColor = JSON.stringify({ ...THEMES[0], id: "bad-color", tokens: { "color.primary": "keine-farbe" } });
    expect(parseThemeImport(badColor).ok).toBe(false);
  });

  it("falls back to the default theme when a corrupt theme reaches the applier", () => {
    const result = applyTheme({ id: "x", name: "y", tokens: { "color.primary": 42 } });
    expect(result.fallback).toBe(true);
    expect(result.themeId).toBe(defaultTheme.id);
  });
});

describe("layout and settings import", () => {
  it("accepts a valid layout and warns about unknown widgets", () => {
    const result = parseLayoutImport(JSON.stringify({ layoutId: "x", widgets: [{ id: "ai-core-orb", x: 0, y: 0, w: 6, h: 4, visible: true }, { id: "fremd", x: 6, y: 0, w: 3, h: 3, visible: true }] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings[0]).toMatch(/fremd/);
  });

  it("rejects widgets outside the grid or with a wrong shape", () => {
    expect(parseLayoutImport(JSON.stringify({ layoutId: "x", columns: 12, widgets: [{ id: "ai-core-orb", x: 10, y: 0, w: 6, h: 4, visible: true }] })).ok).toBe(false);
    expect(parseLayoutImport(JSON.stringify({ layoutId: "x", widgets: [{ id: "a", x: "0" }] })).ok).toBe(false);
  });

  it("validates a settings export against the contract schema", () => {
    const good = { contractVersion: "2.0.0", exportedAt: "2026-10-14T08:00:00Z", settings: { dashboard: { activeLayoutId: "default", fontScale: 1, backgroundGrid: true, soundEffects: false, autoRefreshSeconds: 30, compact: false } }, themes: [], layouts: [] };
    expect(parseSettingsImport(JSON.stringify(good)).ok).toBe(true);
    // a secret smuggled in as an extra field must not pass the schema
    const leaking = { ...good, settings: { ...good.settings, adapters: [{ secret: "x" }] } };
    expect(parseSettingsImport(JSON.stringify(leaking)).ok).toBe(false);
    expect(validateContract("SettingsExport", { nope: true }).valid).toBe(false);
  });
});

describe("adapter schema helpers", () => {
  const schema: FieldSchema = {
    type: "object",
    required: ["host"],
    properties: {
      host: { type: "string", minLength: 3 },
      port: { type: "integer", minimum: 1, maximum: 65535 },
      mode: { type: "string", enum: ["a", "b"] },
      token: { type: "string", format: "password" },
      nested: { type: "object", properties: { flag: { type: "boolean" } } },
      tags: { type: "array", items: { type: "string" } },
      weird: { oneOf: [{ type: "string" }, { type: "number" }] },
    },
  };

  it("derives the field kind from the schema", () => {
    expect(fieldKind("host", schema.properties?.host as FieldSchema)).toBe("string");
    expect(fieldKind("port", schema.properties?.port as FieldSchema)).toBe("integer");
    expect(fieldKind("mode", schema.properties?.mode as FieldSchema)).toBe("enum");
    expect(fieldKind("token", schema.properties?.token as FieldSchema)).toBe("secret");
    expect(fieldKind("anything", {}, new Set(["anything"]))).toBe("secret");
    expect(fieldKind("nested", schema.properties?.nested as FieldSchema)).toBe("object");
    expect(fieldKind("tags", schema.properties?.tags as FieldSchema)).toBe("array");
    expect(fieldKind("weird", schema.properties?.weird as FieldSchema)).toBe("json");
  });

  it("validates required fields and ranges but never demands a write-only secret", () => {
    expect(validateConfig(schema, {}).map((e) => e.path)).toEqual(["host"]);
    expect(validateConfig(schema, { host: "ab", port: 70000 }).map((e) => e.path).sort()).toEqual(["host", "port"]);
    expect(validateConfig(schema, { host: "abc", port: 80, mode: "c" }).map((e) => e.path)).toEqual(["mode"]);
    expect(validateConfig({ ...schema, required: ["host", "token"] }, { host: "abc" })).toEqual([]);
  });

  it("strips secrets from a config object", () => {
    expect(secretPropertyNames(schema, ["extra"])).toEqual(["token", "extra"]);
    expect(stripSecrets({ host: "h", token: "geheim", extra: "x" }, schema, ["extra"])).toEqual({ host: "h" });
  });

  it("compares JSON values independent of key order", () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEqual({ a: undefined }, {})).toBe(true);
  });
});
