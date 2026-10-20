import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CONTRACT_VERSION,
  SCHEMAS,
  SCHEMA_IDS,
  type AdapterConfigSettings,
  type Layout,
  type LayoutImportRequest,
  type Settings,
  type SettingsExport,
  type SettingsPatch,
  type SettingsSchema,
  type SchemaValidator,
  type Theme,
  type ThemeImportRequest,
} from "@friday/sdk";
import type { FridayConfig } from "@friday/config";
import type { Logger } from "@friday/observability";
import { kvGet, kvSet, type Db } from "../db/database";
import type { LibraryStore } from "../db/stores";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { validateBackupSchedule } from "./backup-jobs";

export const SETTINGS_AREAS = [
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
export type SettingsArea = (typeof SETTINGS_AREAS)[number];
export type SettingsAreas = Omit<Settings, "version" | "updatedAt" | "adapters">;

const NAVIGATION_ORDER = [
  "overview",
  "tasks",
  "activity",
  "memory",
  "agents",
  "approvals",
  "communication",
  "calendar",
  "automations",
  "research",
  "content-studio",
  "files",
  "voice",
  "alerts",
  "system",
  "audit",
  "settings",
];

export const FALLBACK_THEME_ID = "friday-command-midnight";
export const FALLBACK_LAYOUT_ID = "friday-command-overview";

function installedVoiceChoice(config: FridayConfig): "friday-female" | "classic" | null {
  try {
    const file = resolve(config.configDir, "..", "..", "config", "voice.json");
    const value = JSON.parse(readFileSync(file, "utf8")) as { tts_voice_choice?: unknown };
    return value.tts_voice_choice === "friday-female" || value.tts_voice_choice === "classic" ? value.tts_voice_choice : null;
  } catch { return null; }
}

export function defaultSettingsAreas(config: FridayConfig): SettingsAreas {
  const locale = config.ui.locale.toLowerCase().startsWith("en") ? "en" : "de";
  return {
    profile: {
      displayName: config.auth.ownerUsername,
      assistantName: "F.R.I.D.A.Y.",
      locale,
      timeZone: config.ui.timezone,
      dateFormat: "dd.MM.yyyy",
      timeFormat: "24h",
      firstDayOfWeek: "monday",
    },
    dashboard: { activeLayoutId: config.ui.layout, fontScale: 1, backgroundGrid: true, soundEffects: false, autoRefreshSeconds: 30, compact: false, contentStudioEnabled: false },
    theme: { activeThemeId: config.ui.theme, cyanIntensity: 1, panelOpacity: 0.72, goldIntensity: 1 },
    orb: {
      preset: "gold-reference",
      size: 1,
      // 0..100 like the contract and @friday/orb's defaults (1 would render the orb at 1 % intensity).
      intensity: 70,
      speed: 1,
      particleDensity: 60,
      audioReactive: true,
      mouseParallax: true,
      bloom: true,
      animations: "full",
      quality: "auto",
      renderMode: "auto",
      statusColors: {
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
      },
    },
    navigation: { order: NAVIGATION_ORDER, hidden: [], defaultPage: "overview", mode: "expanded" },
    modelsRouting: {
      defaultModel: "kimi-coding:kimi-for-coding",
      localFirst: true,
      routes: [
        { taskKind: "voice-routine", model: "kimi-coding:kimi-for-coding", reasoningLevel: "none", fallbackModel: null },
        { taskKind: "voice-complex", model: "kimi-coding:k3", reasoningLevel: "high", fallbackModel: null },
        { taskKind: "voice-critical", model: "kimi-coding:k3", reasoningLevel: "max", fallbackModel: null },
      ],
      monthlyBudgetEur: null,
    },
    voice: {
      wakeWordEnabled: true,
      wakeWord: "Hey Friday",
      pushToTalkKey: "Ctrl+Space",
      speakerVerificationRequired: true,
      storeRawRecordings: false,
      voiceHistoryEnabled: true,
      ttsVoice: installedVoiceChoice(config) ?? "",
      ttsRate: 1,
      inputDeviceId: null,
      outputDeviceId: null,
    },
    notifications: {
      channels: [
        { kind: "dashboard", enabled: true, minPriority: "P4" },
        { kind: "telegram", enabled: true, minPriority: "P2" },
        { kind: "whatsapp", enabled: false, minPriority: "P1" },
        { kind: "sms", enabled: false, minPriority: "P0" },
        { kind: "phone", enabled: false, minPriority: "P0" },
        { kind: "email", enabled: true, minPriority: "P3" },
      ],
      quietHours: { enabled: true, from: "22:00", to: "07:00" },
      defaultEscalation: [
        { afterSeconds: 0, channel: "dashboard", description: "Sofort im Dashboard anzeigen", stopOnAcknowledge: true },
        { afterSeconds: 120, channel: "telegram", description: "Nach 2 Minuten per Telegram", stopOnAcknowledge: true },
        { afterSeconds: 300, channel: "whatsapp", description: "Nach 5 Minuten per WhatsApp", stopOnAcknowledge: true },
      ],
      snoozeDefaultMinutes: 30,
    },
    security: {
      sessionTimeoutMinutes: config.auth.sessionTtlMinutes,
      reauthWindowMinutes: config.auth.reauthWindowMinutes,
      allowRemoteAccess: config.server.allowRemote,
      loginRequired: true,
      auditHashChain: true,
      trustedOrigins: [`http://127.0.0.1:${config.server.port}`, `http://localhost:${config.server.port}`],
    },
    approvals: { defaultExpiryMinutes: 60, draftOnlyByDefault: true, confirmTier2: true, reauthTier3: true, notifyOnRequest: true },
    dataRetention: { activityDays: 90, auditDays: 365, voiceHistoryDays: 30, notificationDays: 60, temporaryFileDays: 7, memoryDefaultTtlDays: null },
    backups: {
      enabled: true,
      schedule: "0 3 * * *",
      targetPath: config.paths.backupDir,
      retentionCount: 14,
      lastBackupAt: null,
      lastBackupStatus: "never",
    },
    developer: {
      debugMode: false,
      showRawJson: false,
      scenarioConsole: config.dev.scenarioConsole,
      orbPerfOverlay: false,
      logLevel: config.logging.level === "trace" || config.logging.level === "fatal" ? "info" : config.logging.level,
    },
  } as SettingsAreas;
}

// ---------------------------------------------------------------------------------------------------------------------
// Theme / layout library
// ---------------------------------------------------------------------------------------------------------------------

const asNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Brings a theme file from `config/themes` into the contract shape. Returns null for files that cannot be repaired. */
export function normalizeTheme(raw: unknown, validator: SchemaValidator): Theme | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const id = typeof source.id === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(source.id) ? source.id : null;
  if (!id || typeof source.tokens !== "object" || source.tokens === null) return null;
  const tokens = Object.fromEntries(
    Object.entries(source.tokens as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && /^[a-z][A-Za-z0-9.]*$/.test(entry[0]),
    ),
  );
  const orb = (typeof source.orb === "object" && source.orb !== null ? source.orb : {}) as Record<string, unknown>;
  const panels = (typeof source.panels === "object" && source.panels !== null ? source.panels : {}) as Record<string, unknown>;
  const corner = panels.cornerStyle;
  const theme: Theme = {
    id,
    name: typeof source.name === "string" && source.name ? source.name : id,
    ...(typeof source.description === "string" ? { description: source.description } : {}),
    builtIn: true,
    tokens,
    orb: {
      preset: typeof orb.preset === "string" && /^[a-z0-9][a-z0-9-]*$/.test(orb.preset) ? orb.preset : "gold-reference",
      particleDensity: asNumber(orb.particleDensity, 1, 0, 1),
      fragmentDensity: asNumber(orb.fragmentDensity, 1, 0, 1),
      glowIntensity: asNumber(orb.glowIntensity, 0.7, 0, 1),
      motionSpeed: asNumber(orb.motionSpeed, 1, 0, 3),
      mouseParallax: typeof orb.mouseParallax === "boolean" ? orb.mouseParallax : true,
    },
    panels: {
      cornerStyle: corner === "rounded" || corner === "square" ? corner : "technical-cut",
      borderIntensity: asNumber(panels.borderIntensity, 0.6, 0, 1),
      backgroundOpacity: asNumber(panels.backgroundOpacity, 0.72, 0, 1),
    },
  };
  return validator.validate("Theme", theme).valid ? theme : null;
}

export function normalizeLayout(raw: unknown, validator: SchemaValidator): Layout | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (typeof source.layoutId !== "string" || !Array.isArray(source.widgets)) return null;
  const widgets = source.widgets
    .filter((widget): widget is Record<string, unknown> => typeof widget === "object" && widget !== null)
    .map((widget) => ({
      id: String(widget.id ?? ""),
      x: Number(widget.x),
      y: Number(widget.y),
      w: Number(widget.w),
      h: Number(widget.h),
      visible: widget.visible !== false,
    }));
  const layout: Layout = {
    layoutId: source.layoutId,
    ...(typeof source.name === "string" ? { name: source.name } : {}),
    ...(typeof source.columns === "number" ? { columns: source.columns } : {}),
    widgets,
  };
  return validator.validate("Layout", layout).valid ? layout : null;
}

function readJsonFiles(dir: string, logger: Logger): Array<{ file: string; value: unknown }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ file: string; value: unknown }> = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json") && !name.endsWith(".schema.json"))) {
    try {
      out.push({ file, value: JSON.parse(readFileSync(join(dir, file), "utf8").replace(/^\uFEFF/, "")) as unknown });
    } catch (error) {
      logger.warn("Theme-/Layout-Datei ist kein gültiges JSON und wird übersprungen", {
        file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}

const FALLBACK_THEME: Theme = {
  id: FALLBACK_THEME_ID,
  name: "F.R.I.D.A.Y. Command / Midnight",
  builtIn: true,
  tokens: { "color.background": "#00030a", "color.primary": "#2fb8d6", "color.orb": "#ffb52e", "text.default": "#dcecf2" },
  orb: { preset: "gold-reference", particleDensity: 0.6, fragmentDensity: 0.7, glowIntensity: 0.66, motionSpeed: 0.85, mouseParallax: false },
  panels: { cornerStyle: "technical-cut", borderIntensity: 0.5, backgroundOpacity: 0.9 },
};

const FALLBACK_LAYOUT: Layout = {
  layoutId: FALLBACK_LAYOUT_ID,
  name: "F.R.I.D.A.Y. Command / Overview",
  columns: 12,
  widgets: [
    { id: "core-overview", x: 0, y: 0, w: 3, h: 7, visible: true },
    { id: "ai-core-orb", x: 3, y: 0, w: 6, h: 7, visible: true },
    { id: "attention-feed", x: 9, y: 0, w: 3, h: 7, visible: true },
  ],
};

/** (Re)seeds the built-in themes/layouts from `config/themes` and `config/layouts`; corrupt files are skipped, not fatal. */
export function seedLibrary(library: LibraryStore, config: FridayConfig, validator: SchemaValidator, logger: Logger): void {
  const themes: Array<{ id: string; value: Theme }> = [];
  for (const { file, value } of readJsonFiles(join(config.configDir, "themes"), logger)) {
    const theme = normalizeTheme(value, validator);
    if (theme) themes.push({ id: theme.id, value: theme });
    else logger.warn("Theme-Datei ist ungültig und wird übersprungen", { file });
  }
  if (!themes.some((entry) => entry.id === FALLBACK_THEME_ID)) themes.push({ id: FALLBACK_THEME_ID, value: FALLBACK_THEME });
  library.replaceBuiltIns("theme", themes);

  const layouts: Array<{ id: string; value: Layout }> = [];
  for (const { file, value } of readJsonFiles(join(config.configDir, "layouts"), logger)) {
    const layout = normalizeLayout(value, validator);
    if (layout) layouts.push({ id: layout.layoutId, value: layout });
    else logger.warn("Layout-Datei ist ungültig und wird übersprungen", { file });
  }
  if (!layouts.some((entry) => entry.id === FALLBACK_LAYOUT_ID)) layouts.push({ id: FALLBACK_LAYOUT_ID, value: FALLBACK_LAYOUT });
  library.replaceBuiltIns("layout", layouts);
}

// ---------------------------------------------------------------------------------------------------------------------

export interface PagedLibraryResult<T> {
  items: T[];
}

/**
 * Persisted dashboard settings (14 areas, PLAN §42). Areas are stored whole in SQLite; `version` is the optimistic
 * concurrency token for `If-Match`. Adapter configuration is owned by the adapter settings service and merged on read.
 */
export class SettingsService {
  private readonly defaults: SettingsAreas;

  constructor(
    private readonly db: Db,
    private readonly config: FridayConfig,
    private readonly validator: SchemaValidator,
    private readonly library: LibraryStore,
    private readonly adapters: () => AdapterConfigSettings[],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.defaults = defaultSettingsAreas(config);
  }

  private areas(): SettingsAreas {
    const stored = new Map(
      (this.db.prepare("SELECT area, json FROM settings_areas").all() as Array<{ area: string; json: string }>).map((row) => [row.area, row.json]),
    );
    const merged: Record<string, unknown> = { ...this.defaults };
    for (const area of SETTINGS_AREAS) {
      const json = stored.get(area);
      if (json === undefined) continue;
      try {
        const value = JSON.parse(json) as unknown;
        merged[area] = value;
      } catch {
        // A damaged row falls back to the default area instead of breaking every settings call.
      }
    }
    const installed = installedVoiceChoice(this.config);
    if (installed && typeof merged.voice === "object" && merged.voice !== null) {
      merged.voice = { ...(merged.voice as SettingsAreas["voice"]), ttsVoice: installed };
    }
    merged.backups = this.withBackupResult(merged.backups as SettingsAreas["backups"]);
    const security = merged.security as SettingsAreas["security"];
    merged.security = { ...security, allowRemoteAccess: this.config.server.allowRemote, auditHashChain: true };
    merged.approvals = { ...(merged.approvals as SettingsAreas["approvals"]), reauthTier3: true };
    return merged as unknown as SettingsAreas;
  }

  private withBackupResult(value: SettingsAreas["backups"]): SettingsAreas["backups"] {
    try {
      const saved = kvGet(this.db, "system_backup.last_result");
      if (!saved) return value;
      const result = JSON.parse(saved) as { at?: unknown; status?: unknown };
      if (typeof result.at !== "string" || !["success", "failed"].includes(String(result.status))) return value;
      return { ...value, lastBackupAt: result.at, lastBackupStatus: result.status as "success" | "failed" };
    } catch { return value; }
  }

  /** One stored area without assembling the whole settings document (cheap enough for per-request checks). */
  area<K extends SettingsArea>(name: K): SettingsAreas[K] {
    const row = this.db.prepare("SELECT json FROM settings_areas WHERE area = ?").get(name) as { json: string } | undefined;
    if (row) {
      try {
        const value = JSON.parse(row.json) as SettingsAreas[K];
        if (name === "voice") {
          const installed = installedVoiceChoice(this.config);
          if (installed) return { ...value, ttsVoice: installed } as SettingsAreas[K];
        }
        if (name === "security") return { ...value, allowRemoteAccess: this.config.server.allowRemote, auditHashChain: true } as SettingsAreas[K];
        if (name === "approvals") return { ...value, reauthTier3: true } as SettingsAreas[K];
        return name === "backups" ? this.withBackupResult(value as SettingsAreas["backups"]) as SettingsAreas[K] : value;
      } catch {
        // fall through to the default
      }
    }
    return name === "backups" ? this.withBackupResult(this.defaults.backups) as SettingsAreas[K] : this.defaults[name];
  }

  version(): number {
    return Number(kvGet(this.db, "settings.version") ?? "1");
  }

  private updatedAt(): string {
    return kvGet(this.db, "settings.updatedAt") ?? this.now().toISOString();
  }

  get(): Settings {
    return { version: this.version(), updatedAt: this.updatedAt(), ...this.areas(), adapters: this.adapters() } as Settings;
  }

  /** Every supplied area replaces the stored area as a whole. `ifMatch` is compared with `settings.version`. */
  patch(patch: SettingsPatch, ifMatch?: number): { settings: Settings; changed: SettingsArea[] } {
    const current = this.version();
    if (ifMatch !== undefined && ifMatch !== current) {
      throw conflict(`Einstellungen wurden zwischenzeitlich geändert (erwartet Version ${ifMatch}, aktuell ${current}).`, {
        expectedVersion: ifMatch,
        currentVersion: current,
      });
    }
    const changed = SETTINGS_AREAS.filter((area) => patch[area] !== undefined);
    if (changed.length > 0) {
      this.assertReferences(patch);
      const stamp = this.now().toISOString();
      this.db.exec("BEGIN");
      try {
        const upsert = this.db.prepare(
          "INSERT INTO settings_areas (area, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(area) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
        );
        for (const area of changed) upsert.run(area, JSON.stringify(patch[area]), stamp);
        kvSet(this.db, "settings.version", String(current + 1));
        kvSet(this.db, "settings.updatedAt", stamp);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    return { settings: this.get(), changed };
  }

  /** A patch may only activate a theme/layout that exists (the UI would otherwise render with no tokens). */
  private assertReferences(patch: SettingsPatch): void {
    for (const channel of patch.notifications?.channels ?? []) {
      // The current messenger draft/target contract is bound to the default gateway profile.
      // An arbitrary saved account ID cannot be delivered or owner-reviewed by that path.
      if (["telegram", "whatsapp", "sms"].includes(channel.kind) && channel.enabled &&
          channel.accountId !== undefined && channel.accountId !== "default") {
        throw validationFailed("Dieser Messenger-Kanal unterstützt derzeit nur das Konto default.",
          [{ path: `notifications.channels.${channel.kind}.accountId`, message: "nur default unterstützt" }]);
      }
    }
    if (patch.backups) {
      try { validateBackupSchedule(patch.backups.schedule); }
      catch { throw validationFailed("Backup-Zeitplan ist ungültig.", [{ path: "backups.schedule", message: "Fünf gültige Cron-Felder erforderlich" }]); }
    }
    if (patch.dataRetention?.memoryDefaultTtlDays !== null && patch.dataRetention?.memoryDefaultTtlDays !== undefined)
      throw validationFailed("Obsidian-Gedächtnis bleibt ohne automatische Ablaufzeit.",
        [{ path: "dataRetention.memoryDefaultTtlDays", message: "nur unbegrenzt unterstützt" }]);
    const location = patch.dashboard?.location;
    if (location && ([location.latitude, location.longitude].some((value) => Math.abs(value - Math.round(value * 100) / 100) > 1e-9))) {
      throw validationFailed("Standortkoordinaten müssen vor dem Speichern auf zwei Dezimalstellen gerundet sein.",
        [{ path: "dashboard.location", message: "höchstens zwei Dezimalstellen" }]);
    }
    if (patch.security?.loginRequired === false && (this.config.server.allowRemote || patch.security.allowRemoteAccess)) {
      throw validationFailed("Ohne Anmeldung darf das Dashboard nur lokal erreichbar sein.", [{ path: "security.loginRequired", message: "Fernzugriff ist aktiviert" }]);
    }
    if (patch.security) {
      const security = patch.security;
      if (security.allowRemoteAccess !== this.config.server.allowRemote) {
        throw validationFailed("Fernzugriff erfordert eine Serverkonfiguration und einen Neustart.",
          [{ path: "security.allowRemoteAccess", message: "kein laufender Netzwerk-Apply verfuegbar" }]);
      }
      if (!security.auditHashChain) {
        throw validationFailed("Die Audit-Hashkette muss aktiv bleiben.",
          [{ path: "security.auditHashChain", message: "Sicherheitskontrolle kann nicht deaktiviert werden" }]);
      }
      if (security.trustedOrigins.length > 16 || security.trustedOrigins.some((value) => {
        try {
          const origin = new URL(value);
          return !["http:", "https:"].includes(origin.protocol) || origin.username !== "" || origin.password !== "" ||
            origin.pathname !== "/" || origin.search !== "" || origin.hash !== "" || origin.origin !== value;
        } catch { return true; }
      }) || new Set(security.trustedOrigins).size !== security.trustedOrigins.length) {
        throw validationFailed("Vertrauenswuerdige Origins muessen eindeutige HTTP(S)-Origins ohne Pfad sein.",
          [{ path: "security.trustedOrigins", message: "ungueltige Origin" }]);
      }
    }
    if (patch.approvals?.reauthTier3 === false) {
      throw validationFailed("Risikostufe 3 erfordert immer eine erneute Authentifizierung.",
        [{ path: "approvals.reauthTier3", message: "Sicherheitskontrolle kann nicht deaktiviert werden" }]);
    }
    if (patch.theme && !this.library.get("theme", patch.theme.activeThemeId)) {
      throw validationFailed(`Das Theme ${patch.theme.activeThemeId} existiert nicht.`, [{ path: "theme.activeThemeId", message: "unbekannt" }]);
    }
    if (patch.dashboard && !this.library.get("layout", patch.dashboard.activeLayoutId)) {
      throw validationFailed(`Das Layout ${patch.dashboard.activeLayoutId} existiert nicht.`, [{ path: "dashboard.activeLayoutId", message: "unbekannt" }]);
    }
  }

  schema(): SettingsSchema {
    return { schema: structuredClone(SCHEMAS[SCHEMA_IDS.Settings]) as SettingsSchema["schema"], areas: [...SETTINGS_AREAS, "adapters"] };
  }

  listThemes(): Theme[] {
    return this.library.list<Theme>("theme");
  }

  listLayouts(): Layout[] {
    return this.library.list<Layout>("layout");
  }

  importTheme(request: ThemeImportRequest): Theme {
    const id = request.theme.id;
    if (this.library.isBuiltIn("theme", id)) {
      throw new ApiError({ code: "CONFLICT", message: `Das integrierte Theme ${id} kann nicht überschrieben werden.`, details: { id } });
    }
    const theme: Theme = { ...structuredClone(request.theme), builtIn: false };
    this.library.put("theme", id, theme, false);
    if (request.activate) this.patchTheme(id);
    return theme;
  }

  importLayout(request: LayoutImportRequest): Layout {
    const layout = structuredClone(request.layout);
    if (this.library.isBuiltIn("layout", layout.layoutId)) {
      throw new ApiError({ code: "CONFLICT", message: `Das integrierte Layout ${layout.layoutId} kann nicht überschrieben werden.`, details: { id: layout.layoutId } });
    }
    this.library.put("layout", layout.layoutId, layout, false);
    if (request.activate) {
      const dashboard = { ...this.areas().dashboard, activeLayoutId: layout.layoutId };
      this.patch({ dashboard });
    }
    return layout;
  }

  private patchTheme(id: string): void {
    this.patch({ theme: { ...this.areas().theme, activeThemeId: id } });
  }

  /** Secrets never appear: the export holds the 13 non-adapter areas, the custom library and nothing else. */
  export(): SettingsExport {
    return {
      contractVersion: CONTRACT_VERSION,
      exportedAt: this.now().toISOString(),
      settings: structuredClone(this.areas()) as SettingsPatch,
      themes: this.listThemes(),
      layouts: this.listLayouts(),
    };
  }

  /**
   * Applies an export. The body already passed schema validation; what is repaired here are dangling references:
   * an active theme/layout that is not in the library falls back to the default instead of leaving the UI unstyled.
   */
  import(body: SettingsExport): { settings: Settings; repairs: string[] } {
    const repairs: string[] = [];
    for (const theme of body.themes) {
      if (this.library.isBuiltIn("theme", theme.id)) continue;
      this.library.put("theme", theme.id, { ...structuredClone(theme), builtIn: false }, false);
    }
    for (const layout of body.layouts) {
      if (this.library.isBuiltIn("layout", layout.layoutId)) continue;
      this.library.put("layout", layout.layoutId, structuredClone(layout), false);
    }
    const patch: SettingsPatch = structuredClone(body.settings);
    if (patch.theme && !this.library.get("theme", patch.theme.activeThemeId)) {
      repairs.push(`theme.activeThemeId ${patch.theme.activeThemeId} -> ${FALLBACK_THEME_ID}`);
      patch.theme = { ...patch.theme, activeThemeId: FALLBACK_THEME_ID };
    }
    if (patch.dashboard && !this.library.get("layout", patch.dashboard.activeLayoutId)) {
      repairs.push(`dashboard.activeLayoutId ${patch.dashboard.activeLayoutId} -> ${FALLBACK_LAYOUT_ID}`);
      patch.dashboard = { ...patch.dashboard, activeLayoutId: FALLBACK_LAYOUT_ID };
    }
    // The import is a deliberate overwrite; a stale If-Match makes no sense here.
    const { settings } = this.patch(patch);
    return { settings, repairs };
  }

  validateAreas(patch: SettingsPatch): void {
    for (const area of SETTINGS_AREAS) {
      const value = patch[area];
      if (value === undefined) continue;
      const result = this.validator.validate("Settings", { ...this.get(), [area]: value });
      if (!result.valid) throw validationFailed(`Einstellungsbereich ${area} ist ungültig.`, result.errors);
    }
    this.assertReferences(patch);
  }
}
