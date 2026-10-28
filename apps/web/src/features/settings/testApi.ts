import type { AdapterConfigSettings, Layout, Role, Settings, Theme } from "@friday/sdk";
import { jsonResponse } from "@/test/render";

/** Fake Control API for the settings and scenario console component tests: routes by method and path, records every call. */

export interface RecordedCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  ifMatch: string | null;
}

export function makeSettings(partial: Partial<Settings> = {}): Settings {
  return {
    version: 3,
    updatedAt: "2026-10-14T08:00:00Z",
    profile: { displayName: "Erik Brandt", assistantName: "F.R.I.D.A.Y.", locale: "de", timeZone: "Europe/Berlin", dateFormat: "dd.MM.yyyy", timeFormat: "24h", firstDayOfWeek: "monday" },
    dashboard: { activeLayoutId: "default", fontScale: 1, backgroundGrid: true, soundEffects: false, autoRefreshSeconds: 30, compact: false, contentStudioEnabled: false },
    theme: { activeThemeId: "friday-navy-cyan", cyanIntensity: 1, panelOpacity: 0.72, goldIntensity: 1 },
    orb: {
      preset: "gold",
      size: 1,
      intensity: 70,
      speed: 1,
      particleDensity: 60,
      audioReactive: true,
      mouseParallax: true,
      bloom: true,
      animations: "full",
      quality: "auto",
      renderMode: "auto",
      statusColors: { listening: "#4DD6FF", error: "#FF5A4D" },
    },
    navigation: { order: ["overview", "tasks", "activity", "memory", "agents", "approvals", "communication", "calendar", "automations", "research", "files", "voice", "alerts", "system", "audit", "settings"], hidden: [], defaultPage: "overview", mode: "expanded" },
    modelsRouting: { defaultModel: "Kimi K3", localFirst: true, routes: [{ taskKind: "coding", model: "Kimi K3", reasoningLevel: "high", fallbackModel: null }], monthlyBudgetEur: 150 },
    voice: { wakeWordEnabled: true, wakeWord: "Hey Jarvis", pushToTalkKey: "Ctrl+Space", speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: true, sttLanguage: "de", sttModel: "small", ttsVoice: "de_DE-thorsten-medium", ttsRate: 1, inputDeviceId: null, outputDeviceId: null },
    notifications: { channels: [{ kind: "dashboard", enabled: true, minPriority: "P3" }], quietHours: { enabled: false, from: "22:00", to: "07:00" }, defaultEscalation: [], snoozeDefaultMinutes: 15 },
    security: { sessionTimeoutMinutes: 480, reauthWindowMinutes: 10, allowRemoteAccess: false, auditHashChain: true, trustedOrigins: ["http://127.0.0.1:3100"] },
    approvals: { defaultExpiryMinutes: 60, draftOnlyByDefault: true, confirmTier2: true, reauthTier3: true, notifyOnRequest: true },
    dataRetention: { activityDays: 90, auditDays: 365, voiceHistoryDays: 30, notificationDays: 60, temporaryFileDays: 7, memoryDefaultTtlDays: null },
    backups: { enabled: true, schedule: "0 3 * * *", targetPath: "D:\\Friday\\backups", retentionCount: 7, lastBackupAt: null, lastBackupStatus: "never" },
    developer: { debugMode: false, showRawJson: false, scenarioConsole: true, orbPerfOverlay: false, logLevel: "info" },
    adapters: [],
    ...partial,
  };
}

export const THEMES: Theme[] = [
  {
    id: "friday-navy-cyan",
    name: "F.R.I.D.A.Y. Navy & Cyan",
    description: "Standardthema",
    builtIn: true,
    tokens: { "color.background": "#050B14", "color.primary": "#22D3EE", "color.orb": "#F5B942" },
    orb: { preset: "gold", particleDensity: 1, fragmentDensity: 1, glowIntensity: 1, motionSpeed: 1, mouseParallax: true },
    panels: { cornerStyle: "technical-cut", borderIntensity: 0.6, backgroundOpacity: 0.72 },
  },
];

export const LAYOUTS: Layout[] = [
  {
    layoutId: "default",
    name: "Standard",
    columns: 12,
    widgets: [
      { id: "core-overview", x: 0, y: 0, w: 3, h: 7, visible: true },
      { id: "ai-core-orb", x: 3, y: 0, w: 6, h: 7, visible: true },
      { id: "attention-feed", x: 9, y: 0, w: 3, h: 7, visible: true },
    ],
  },
  {
    layoutId: "kompakt",
    name: "Kompakt",
    columns: 12,
    widgets: [
      { id: "ai-core-orb", x: 0, y: 0, w: 8, h: 8, visible: true },
      { id: "attention-feed", x: 8, y: 0, w: 4, h: 8, visible: true },
    ],
  },
];

export const ADAPTERS: AdapterConfigSettings[] = [
  {
    adapterId: "mock-communication",
    category: "communication",
    provider: "mock-communication",
    enabled: true,
    version: 7,
    config: { latencyMs: 0, imapHost: "imap.example" },
    configSchema: {
      type: "object",
      title: "Mock Kommunikation",
      required: ["imapHost"],
      properties: {
        imapHost: { type: "string", title: "IMAP-Server" },
        latencyMs: { type: "integer", minimum: 0, maximum: 10000, title: "Latenz (ms)" },
        imapPassword: { type: "string", format: "password", title: "IMAP-Passwort", writeOnly: true },
      },
    },
    secretFields: { imapPassword: { configured: true, maskedHint: "••••••" } },
  },
];

const FRESH = () => ({ state: "fresh" as const, asOf: "2026-10-14T08:00:00Z" });
const single = (data: unknown): Response => jsonResponse({ contractVersion: "2.0.0", data, freshness: FRESH() });
const list = (items: unknown[]): Response =>
  jsonResponse({ contractVersion: "2.0.0", items, pageInfo: { nextCursor: null, hasNextPage: false }, freshness: FRESH(), sources: [] });
const apiError = (status: number, code: string, message: string): Response =>
  jsonResponse({ error: { code, message, severity: "warning", retryable: false, correlationId: "corr_01JAAAAAAAAAAAAAAAAAAAAAAA", details: {} } }, status);

export interface FakeApiOptions {
  role?: Role;
  settings?: Settings;
  devScenarios?: boolean;
  scenarioControls?: boolean;
  /** PATCH /settings answers 409 once (stale If-Match). */
  conflictOnce?: boolean;
  /** Extra route handler, consulted first; return undefined to fall through. */
  extra?: (call: RecordedCall) => Response | undefined;
  /** Data mode the fake `/meta` reports; decides whether the UI may talk about simulation. */
  dataMode?: "mock" | "hybrid" | "live";
  /** Configured adapters; a reduced list models a host where only some categories are set up. */
  adapters?: AdapterConfigSettings[];
}

export function createFakeApi(options: FakeApiOptions = {}) {
  const calls: RecordedCall[] = [];
  const state = { settings: options.settings ?? makeSettings(), layouts: LAYOUTS.map((l) => ({ ...l })), conflict: Boolean(options.conflictOnce), forced: null as string | null };
  const role = options.role ?? "owner";

  const scenarioState = () => ({
    activeScenarioId: null,
    running: false,
    stepIndex: 0,
    seed: 42,
    simulatedTime: "2026-10-14T08:15:00Z",
    clockOffsetMs: 0,
    adapterOverrides: [],
    capabilityOverrides: [],
    forcedOrbMode: state.forced,
  });

  const fetchImpl: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = request.method;
    let body: unknown;
    if (method !== "GET" && method !== "HEAD") {
      const text = await request.clone().text();
      body = text ? (JSON.parse(text) as unknown) : undefined;
    }
    const call: RecordedCall = { method, path, query: Object.fromEntries(url.searchParams), body, ifMatch: request.headers.get("If-Match") };
    calls.push(call);
    const extra = options.extra?.(call);
    if (extra) return extra;

    if (method === "GET" && path === "/auth/session") {
      return single({ authenticated: true, user: { id: "usr_01JAAAAAAAAAAAAAAAAAAAAAAA", username: "erik", displayName: "Erik Brandt", role }, role, csrfToken: "csrf", expiresAt: "2026-10-14T18:00:00Z", reauthUntil: null });
    }
    if (method === "GET" && path === "/meta") {
      return jsonResponse({ contractVersion: "2.0.0", apiVersion: "v1", dataMode: options.dataMode ?? "mock", eventsPath: "/api/v1/events", buildVersion: "test", features: { devScenarios: options.devScenarios ?? true, scenarioControls: options.scenarioControls ?? true }, defaultLocale: "de" });
    }
    if (method === "GET" && path === "/settings") return single(state.settings);
    if (method === "PATCH" && path === "/settings") {
      if (state.conflict) {
        state.conflict = false;
        return apiError(409, "CONFLICT", "Version veraltet");
      }
      state.settings = { ...state.settings, ...(body as Partial<Settings>), version: state.settings.version + 1 };
      return single(state.settings);
    }
    if (method === "GET" && path === "/settings/export") {
      const { adapters: _adapters, version: _version, updatedAt: _updatedAt, ...areas } = state.settings;
      return jsonResponse({ contractVersion: "2.0.0", exportedAt: "2026-10-14T08:00:00Z", settings: areas, themes: THEMES, layouts: state.layouts });
    }
    if (method === "POST" && path === "/settings/import") return single(state.settings);
    if (method === "POST" && path === "/settings/themes/import") return single((body as { theme: Theme }).theme);
    if (method === "GET" && path === "/settings/themes") return list(THEMES);
    if (method === "GET" && path === "/settings/layouts") return list(state.layouts);
    if (method === "POST" && path === "/settings/layouts/import") {
      const request = body as { layout: Layout; activate?: boolean };
      state.layouts = [...state.layouts.filter((l) => l.layoutId !== request.layout.layoutId), request.layout];
      if (request.activate) state.settings = { ...state.settings, dashboard: { ...state.settings.dashboard, activeLayoutId: request.layout.layoutId }, version: state.settings.version + 1 };
      return single(request.layout);
    }
    if (method === "GET" && path === "/settings/adapters") return role === "owner" ? list(options.adapters ?? ADAPTERS) : apiError(403, "FORBIDDEN", "verboten");
    if (method === "PATCH" && path.startsWith("/settings/adapters/")) return single(ADAPTERS[0]);
    if (method === "POST" && path.endsWith("/test")) {
      return single({ adapterId: "mock-communication", success: true, latencyMs: 12, message: "Verbindung erfolgreich getestet.", testedAt: "2026-10-14T08:00:00Z", correlationId: "corr_01JAAAAAAAAAAAAAAAAAAAAAAA" });
    }
    if (method === "GET" && path === "/capabilities") {
      return jsonResponse({ contractVersion: "2.0.0", modules: { tasks: { read: true, create: true }, mail: { read: true, send: true }, system: { read: true } } });
    }
    if (method === "GET" && path === "/voice/devices") return list([]);
    if (method === "GET" && path === "/system/models") return list([]);
    if (method === "GET" && path === "/adapters") return list([{ manifest: { id: "mock-communication" }, health: {}, enabled: true, provider: "mock-communication", mode: "mock" }]);
    if (method === "GET" && path === "/activity") return list([]);
    if (method === "GET" && path === "/orb/status") {
      return single({ status: { mode: state.forced ?? "idle", health: "online", since: "2026-10-14T08:00:00Z", urgency: "none", progressMode: "none", activityText: "Bereit" }, layers: { voice: "idle", work: "idle", attention: "none", health: "online", activeAgentIds: [] } });
    }
    if (method === "GET" && path === "/dev/scenarios") return list([{ id: "clean-idle", name: "Clean Idle", description: "Alles online", steps: [{ index: 0, label: "Alles online", delayMs: 0 }] }]);
    if (method === "GET" && path === "/dev/scenarios/state") return single(scenarioState());
    if (method === "POST" && path.startsWith("/dev/scenarios/") && path.endsWith("/play")) return single({ ...scenarioState(), activeScenarioId: "clean-idle", running: true });
    if (method === "POST" && path === "/dev/scenarios/control") {
      const request = body as { action: string; mode?: string };
      if (request.action === "force_orb_state") state.forced = request.mode ?? null;
      if (request.action === "reset" || request.action === "release_orb_state") state.forced = null;
      return single(scenarioState());
    }
    return apiError(404, "NOT_FOUND", `${method} ${path}`);
  };

  return {
    fetchImpl,
    calls,
    state,
    /** Calls matching a method and path (exact). */
    find: (method: string, path: string): RecordedCall[] => calls.filter((call) => call.method === method && call.path === path),
  };
}
