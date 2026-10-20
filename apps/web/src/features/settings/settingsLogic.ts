import { applyTheme, defaultTheme, getTheme, type FridayTheme, validateTheme } from "@friday/design-tokens";
import type { Layout, LayoutWidget, OrbMode, Settings, SettingsExport, Theme } from "@friday/sdk";
import { runtimeThemeSettings } from "@/lib/settings";
import { DEFAULT_OVERVIEW_LAYOUT, WIDGET_IDS } from "@/features/overview/layout";
import { validateContract, formatIssues } from "./jsonSchemaValidate";

/* ── areas ────────────────────────────────────────────────────────────── */

/** The 14 settings areas of PLAN §42.1 plus the layout editor of §42.5 (shown right below "Dashboard"). */
export const SETTINGS_AREAS = [
  "profile",
  "dashboard",
  "layout",
  "theme",
  "orb",
  "navigation",
  "adapters",
  "skillAccounts",
  "contentStudioKeys",
  "modelsRouting",
  "hermesConfig",
  "voice",
  "notifications",
  "security",
  "approvals",
  "dataRetention",
  "backups",
  "developer",
] as const;
export type SettingsAreaId = (typeof SETTINGS_AREAS)[number];

/** Areas stored in `PATCH /settings` (everything except the adapter list and the layout editor). */
export const DRAFT_AREAS = [
  "profile",
  "dashboard",
  "theme",
  "orb",
  "navigation",
  "modelsRouting",
  "voice",
  "notifications",
  "security",
  "approvals",
  "dataRetention",
  "backups",
  "developer",
] as const satisfies readonly (keyof Settings)[];
export type DraftAreaId = (typeof DRAFT_AREAS)[number];

export const isSettingsArea = (value: string | null | undefined): value is SettingsAreaId =>
  (SETTINGS_AREAS as readonly string[]).includes(value ?? "");

/* ── orb ──────────────────────────────────────────────────────────────── */

export const ORB_MODES = [
  "booting",
  "idle",
  "listening",
  "transcribing",
  "thinking",
  "syncing",
  "working",
  "speaking",
  "waiting_approval",
  "success",
  "warning",
  "error",
  "offline",
  "paused",
] as const satisfies readonly OrbMode[];

/** Reference accents per status (secondary only; the gold core never changes, PLAN §23.2/§42.3). */
export const DEFAULT_STATUS_COLORS: Record<string, string> = {
  listening: "#4DD6FF",
  transcribing: "#4DD6FF",
  thinking: "#B28CFF",
  syncing: "#4DD6FF",
  working: "#FFB347",
  speaking: "#FFD166",
  waiting_approval: "#FFB347",
  success: "#7DF9A1",
  warning: "#FF9A3D",
  error: "#FF5A4D",
  offline: "#8A6A3C",
  paused: "#A88B55",
};

export const ORB_PRESETS = ["gold", "amber", "calm", "dense"] as const;

/* ── navigation ───────────────────────────────────────────────────────── */

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(target, 0, item);
  return next;
}

/** Full order of all known pages: stored order first (unknown ids dropped, duplicates removed), missing pages appended. */
export function normalizeNavOrder(order: readonly string[], allIds: readonly string[]): string[] {
  const known = new Set(allIds);
  const result: string[] = [];
  for (const id of order) if (known.has(id) && !result.includes(id)) result.push(id);
  for (const id of allIds) if (!result.includes(id)) result.push(id);
  return result;
}

/* ── layout editor ────────────────────────────────────────────────────── */

export const LAYOUT_MAX_ROWS = 40;

export function layoutColumns(layout: Layout): number {
  return layout.columns ?? 12;
}

function clampWidget(widget: LayoutWidget, columns: number): LayoutWidget {
  const w = Math.max(1, Math.min(columns, Math.round(widget.w)));
  const h = Math.max(1, Math.min(LAYOUT_MAX_ROWS, Math.round(widget.h)));
  const x = Math.max(0, Math.min(columns - w, Math.round(widget.x)));
  const y = Math.max(0, Math.min(LAYOUT_MAX_ROWS - h, Math.round(widget.y)));
  return { ...widget, x, y, w, h };
}

export function updateWidget(layout: Layout, id: string, patch: Partial<Omit<LayoutWidget, "id">>): Layout {
  const columns = layoutColumns(layout);
  return { ...layout, widgets: layout.widgets.map((widget) => (widget.id === id ? clampWidget({ ...widget, ...patch }, columns) : widget)) };
}

export function moveWidget(layout: Layout, id: string, dx: number, dy: number): Layout {
  const widget = layout.widgets.find((candidate) => candidate.id === id);
  return widget ? updateWidget(layout, id, { x: widget.x + dx, y: widget.y + dy }) : layout;
}

export function resizeWidget(layout: Layout, id: string, dw: number, dh: number): Layout {
  const widget = layout.widgets.find((candidate) => candidate.id === id);
  return widget ? updateWidget(layout, id, { w: widget.w + dw, h: widget.h + dh }) : layout;
}

/** Adds a widget that is not part of the layout yet at the first free row below everything else. */
export function addWidget(layout: Layout, id: string): Layout {
  if (layout.widgets.some((widget) => widget.id === id)) return updateWidget(layout, id, { visible: true });
  const fallback = DEFAULT_OVERVIEW_LAYOUT.widgets.find((widget) => widget.id === id);
  const bottom = layout.widgets.reduce((max, widget) => Math.max(max, widget.y + widget.h), 0);
  const columns = layoutColumns(layout);
  const base: LayoutWidget = fallback ? { ...fallback, x: 0, y: bottom, visible: true } : { id, x: 0, y: bottom, w: Math.min(4, columns), h: 4, visible: true };
  return { ...layout, widgets: [...layout.widgets, clampWidget(base, columns)] };
}

/** Pairs of visible widgets whose rectangles intersect (the overview renders them on top of each other). */
export function layoutOverlaps(layout: Layout): [string, string][] {
  const visible = layout.widgets.filter((widget) => widget.visible);
  const pairs: [string, string][] = [];
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const a = visible[i] as LayoutWidget;
      const b = visible[j] as LayoutWidget;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

export const layoutRows = (layout: Layout): number => Math.max(8, layout.widgets.reduce((max, widget) => Math.max(max, widget.y + widget.h), 0));

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

/* ── JSON files: download and import parsing ──────────────────────────── */

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking right away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export type ImportResult<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[] };

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; errors: string[] } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, errors: [`Ungültiges JSON: ${error instanceof Error ? error.message : "nicht lesbar"}`] };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Wire theme (`Theme`) -> design-tokens theme. */
export function toRuntimeTheme(theme: Theme): FridayTheme {
  return {
    id: theme.id,
    name: theme.name,
    version: 1,
    tokens: theme.tokens,
    orb: theme.orb,
    panels: { ...theme.panels, cornerStyle: theme.panels.cornerStyle === "rounded" ? "soft-cut" : theme.panels.cornerStyle },
    effects: { gridVisibility: 1, cyanIntensity: 1 },
  } as unknown as FridayTheme;
}

/**
 * Parses and validates a theme file (PLAN §25.5): JSON, then the contract JSON Schema `Theme`, then the colour rules of the
 * design-token validator. Anything invalid is rejected (the caller keeps / falls back to the default theme).
 */
export function parseThemeImport(text: string): ImportResult<Theme> {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  // Theme files written by hand rarely carry `builtIn`; an import is never a built-in.
  const candidate = isRecord(parsed.value) ? { ...parsed.value, builtIn: false } : parsed.value;
  const schema = validateContract("Theme", candidate);
  if (!schema.valid) return { ok: false, errors: formatIssues(schema.errors) };
  const theme = candidate as Theme;
  const runtime = validateTheme(toRuntimeTheme(theme));
  if (!runtime.ok) return { ok: false, errors: runtime.errors.slice(0, 6) };
  return { ok: true, value: theme, warnings: [] };
}

export function parseLayoutImport(text: string): ImportResult<Layout> {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  const schema = validateContract("Layout", parsed.value);
  if (!schema.valid) return { ok: false, errors: formatIssues(schema.errors) };
  const layout = parsed.value as Layout;
  const columns = layout.columns ?? 12;
  const problems: string[] = [];
  for (const widget of layout.widgets) {
    if (widget.x + widget.w > columns) problems.push(`Widget „${widget.id}“ ragt über die ${columns} Spalten hinaus.`);
  }
  if (problems.length) return { ok: false, errors: problems };
  const warnings = layout.widgets.filter((widget) => !(WIDGET_IDS as readonly string[]).includes(widget.id)).map((widget) => `Unbekanntes Widget „${widget.id}“ wird nicht angezeigt.`);
  return { ok: true, value: layout, warnings };
}

export function parseSettingsImport(text: string): ImportResult<SettingsExport> {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  const schema = validateContract("SettingsExport", parsed.value);
  if (!schema.valid) return { ok: false, errors: formatIssues(schema.errors) };
  return { ok: true, value: parsed.value as SettingsExport, warnings: [] };
}

/* ── live theme preview ───────────────────────────────────────────────── */

/** Resolves the theme exactly like `AppSettingsProvider`: built-in token themes first, then the server library, then the default. */
export function resolveRuntimeTheme(themeId: string, overrides: Record<string, string> | undefined, library: readonly Theme[] | undefined): FridayTheme {
  const base = getTheme(themeId) ?? library?.map(toRuntimeTheme).find((candidate) => candidate.id === themeId) ?? defaultTheme;
  return overrides ? { ...base, tokens: { ...base.tokens, ...overrides } } : base;
}

/** Applies a (draft) theme + dashboard knobs to the document without touching the stored settings. Returns whether it fell back. */
export function previewTheme(settings: Pick<Settings, "theme" | "dashboard">, library: readonly Theme[] | undefined): boolean {
  const theme = resolveRuntimeTheme(settings.theme.activeThemeId, settings.theme.overrides, library);
  return applyTheme(theme, { settings: runtimeThemeSettings(settings as Settings) }).fallback;
}
