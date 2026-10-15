import {
  CONTRACT_VERSION,
  SCHEMAS,
  SCHEMA_IDS,
  type AdapterConfigPatch,
  type AdapterConfigSettings,
  type AdapterTestResult,
  type Layout,
  type LayoutImportRequest,
  type Settings,
  type SettingsExport,
  type SettingsPatch,
  type SettingsSchema,
  type Theme,
  type ThemeImportRequest,
} from "@friday/sdk";
import { MockApiError, notFound, validationFailed } from "../../core/errors";
import { clone, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { pageOf, type Query } from "./shared";

const AREAS = [
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
] as const;

type Area = (typeof AREAS)[number];

export class SettingsService {
  constructor(private readonly w: MockWorld) {}

  get(): Settings {
    return clone(this.w.state.settings);
  }

  /** Every supplied area replaces the stored area as a whole. `If-Match` is compared with `settings.version`. */
  patch(body: SettingsPatch, ctx?: OpContext): Settings {
    this.w.validate("SettingsPatch", body);
    const settings = this.w.state.settings;
    const expected = this.w.parseIfMatch(ctx);
    if (expected !== null && expected !== settings.version) {
      throw new MockApiError({ code: "CONFLICT", message: `Einstellungen wurden zwischenzeitlich geändert (erwartet Version ${expected}, aktuell ${settings.version}).`, details: { expectedVersion: expected, currentVersion: settings.version } });
    }
    const changed: Area[] = [];
    for (const area of AREAS) {
      const value = body[area];
      if (value !== undefined) {
        (settings as unknown as Record<string, unknown>)[area] = clone(value);
        changed.push(area);
      }
    }
    if (changed.length > 0) {
      settings.version += 1;
      settings.updatedAt = this.w.nowIso();
      const correlationId = this.w.correlationId(ctx);
      this.w.recordAudit({ category: "user_action", action: "settings.updated", correlationId, adapterId: "mock-system", actor: this.w.actorOf(ctx), after: { areas: changed, version: settings.version } });
      this.w.refresh();
    }
    return clone(settings);
  }

  schema(): SettingsSchema {
    const document = SCHEMAS[SCHEMA_IDS.Settings];
    return { schema: clone(document) as SettingsSchema["schema"], areas: [...AREAS, "adapters"] };
  }

  listAdapters(query: Query<"listAdapterSettings"> = {}): Page<AdapterConfigSettings> {
    return pageOf(this.w.state.settings.adapters, query);
  }

  /** Secrets are write-only: only the `configured` flag and a masked hint are kept. */
  updateAdapter(id: string, patch: AdapterConfigPatch, ctx?: OpContext): AdapterConfigSettings {
    this.w.validate("AdapterConfigPatch", patch);
    const entry = this.w.state.settings.adapters.find((candidate) => candidate.adapterId === id);
    if (!entry) throw notFound("Adapter", id);
    const properties = ((entry.configSchema as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>;
    if (patch.config) {
      const unknown = Object.keys(patch.config).filter((key) => !(key in properties));
      if (unknown.length) throw validationFailed(`Unbekannte Konfigurationsfelder: ${unknown.join(", ")}.`, unknown.map((key) => ({ path: `config.${key}`, message: "nicht im Schema" })));
    }
    if (patch.secrets) {
      const unknown = Object.keys(patch.secrets).filter((key) => !(key in entry.secretFields));
      if (unknown.length) throw validationFailed(`Unbekannte Secret-Felder: ${unknown.join(", ")}.`, unknown.map((key) => ({ path: `secrets.${key}`, message: "kein Secret-Feld" })));
      for (const key of Object.keys(patch.secrets)) entry.secretFields[key] = { configured: true, maskedHint: "••••••" };
    }
    if (patch.provider !== undefined) entry.provider = patch.provider;
    if (patch.config) {
      entry.config = { ...entry.config, ...patch.config };
      const adapter = this.w.adapter(entry.category);
      if (typeof patch.config.latencyMs === "number") adapter.latencyOverrideMs = patch.config.latencyMs;
      if (typeof patch.config.errorRate === "number") adapter.errorRateOverride = patch.config.errorRate;
    }
    if (patch.enabled !== undefined && patch.enabled !== entry.enabled) {
      entry.enabled = patch.enabled;
      const adapter = this.w.adapter(entry.category);
      adapter.enabled = patch.enabled;
      this.w.emit("friday.adapter.health_changed", this.w.adapterHealth(entry.category), { source: "control-api://core", subject: `adapter/${id}` });
    }
    this.w.state.settings.version += 1;
    this.w.state.settings.updatedAt = this.w.nowIso();
    this.w.recordAudit({
      category: "user_action",
      action: "settings.adapter_updated",
      severity: "warning",
      correlationId: this.w.correlationId(ctx),
      adapterId: id,
      actor: this.w.actorOf(ctx),
      // Only names are recorded, never values.
      after: { enabled: entry.enabled, configKeys: Object.keys(patch.config ?? {}), secretsUpdated: Object.keys(patch.secrets ?? {}) },
    });
    this.w.refresh();
    return clone(entry);
  }

  testAdapter(id: string, ctx?: OpContext): AdapterTestResult {
    const entry = this.w.state.settings.adapters.find((candidate) => candidate.adapterId === id);
    if (!entry) throw notFound("Adapter", id);
    const adapter = this.w.adapter(entry.category);
    const success = adapter.enabled && adapter.mode === "online";
    entry.lastTestAt = this.w.nowIso();
    entry.lastTestResult = success ? "success" : "failure";
    return {
      adapterId: id,
      success,
      latencyMs: success ? (adapter.latencyMs ?? 5) + this.w.state.control.latencyMs : null,
      message: success ? "Verbindung erfolgreich getestet." : adapter.enabled ? `Adapter nicht erreichbar (${adapter.mode}).` : "Adapter ist deaktiviert.",
      testedAt: entry.lastTestAt,
      correlationId: this.w.correlationId(ctx),
    };
  }

  listThemes(query: Query<"listThemes"> = {}): Page<Theme> {
    return pageOf(this.w.state.themes, query);
  }

  importTheme(body: ThemeImportRequest, ctx?: OpContext): Theme {
    this.w.validate("ThemeImportRequest", body);
    const existing = this.w.state.themes.find((candidate) => candidate.id === body.theme.id);
    if (existing?.builtIn) throw new MockApiError({ code: "CONFLICT", message: `Das integrierte Thema ${existing.name} kann nicht überschrieben werden.`, details: { id: existing.id } });
    const theme: Theme = { ...clone(body.theme), builtIn: false };
    this.w.state.themes = [...this.w.state.themes.filter((candidate) => candidate.id !== theme.id), theme];
    if (body.activate) {
      this.w.state.settings.theme.activeThemeId = theme.id;
      this.w.state.settings.version += 1;
      this.w.state.settings.updatedAt = this.w.nowIso();
    }
    this.w.recordAudit({ category: "user_action", action: "settings.theme_imported", correlationId: this.w.correlationId(ctx), adapterId: "mock-system", actor: this.w.actorOf(ctx), after: { themeId: theme.id, activated: Boolean(body.activate) } });
    return clone(theme);
  }

  listLayouts(query: Query<"listLayouts"> = {}): Page<Layout> {
    return pageOf(this.w.state.layouts, query);
  }

  importLayout(body: LayoutImportRequest, ctx?: OpContext): Layout {
    this.w.validate("LayoutImportRequest", body);
    const layout = clone(body.layout);
    this.w.state.layouts = [...this.w.state.layouts.filter((candidate) => candidate.layoutId !== layout.layoutId), layout];
    if (body.activate) {
      this.w.state.settings.dashboard.activeLayoutId = layout.layoutId;
      this.w.state.settings.version += 1;
      this.w.state.settings.updatedAt = this.w.nowIso();
    }
    this.w.recordAudit({ category: "user_action", action: "settings.layout_imported", correlationId: this.w.correlationId(ctx), adapterId: "mock-system", actor: this.w.actorOf(ctx), after: { layoutId: layout.layoutId, activated: Boolean(body.activate) } });
    return clone(layout);
  }

  /** Portable export. Adapter areas (and with them every secret) are never part of it. */
  export(): SettingsExport {
    const { adapters: _adapters, version: _version, updatedAt: _updatedAt, ...areas } = clone(this.w.state.settings);
    return {
      contractVersion: CONTRACT_VERSION,
      exportedAt: this.w.nowIso(),
      settings: areas as SettingsPatch,
      themes: clone(this.w.state.themes),
      layouts: clone(this.w.state.layouts),
    };
  }

  import(body: SettingsExport, ctx?: OpContext): Settings {
    this.w.validate("SettingsExport", body);
    this.patch(body.settings, { ...ctx, ifMatch: undefined });
    for (const theme of body.themes) {
      if (this.w.state.themes.some((candidate) => candidate.id === theme.id && candidate.builtIn)) continue;
      this.w.state.themes = [...this.w.state.themes.filter((candidate) => candidate.id !== theme.id), { ...clone(theme), builtIn: false }];
    }
    for (const layout of body.layouts) {
      this.w.state.layouts = [...this.w.state.layouts.filter((candidate) => candidate.layoutId !== layout.layoutId), clone(layout)];
    }
    return clone(this.w.state.settings);
  }
}
