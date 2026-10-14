import type {
  AdapterCategory,
  AdapterConfigSettings,
  Layout,
  OrbSettings,
  Settings,
  Theme,
} from "@jarvis/sdk";
import { ADAPTER_CATEGORIES, CATEGORY_LABEL, adapterIdFor } from "../core/constants";
import type { SeedContext } from "./context";

export const NAVIGATION_ORDER = [
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
  "files",
  "voice",
  "alerts",
  "system",
  "audit",
  "settings",
];

export function defaultOrbSettings(): OrbSettings {
  return {
    preset: "gold-reference",
    size: 1,
    intensity: 1,
    speed: 1,
    particleDensity: 1,
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
  };
}

const SECRETS: Partial<Record<AdapterCategory, string[]>> = {
  communication: ["imapPassword", "smtpPassword"],
  system: ["workerToken"],
};

export function adapterSecretFields(category: AdapterCategory): string[] {
  return SECRETS[category] ?? [];
}

export function adapterConfigSchema(category: AdapterCategory): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    latencyMs: { type: "integer", minimum: 0, maximum: 10_000, default: 0, title: "Simulierte Latenz (ms)" },
    errorRate: { type: "number", minimum: 0, maximum: 1, default: 0, title: "Fehlerquote (0 bis 1)" },
  };
  if (category === "communication") {
    properties.imapHost = { type: "string", default: "imap.gmx.example", title: "IMAP-Server" };
    properties.imapPassword = { type: "string", format: "password", title: "IMAP-Passwort", writeOnly: true };
    properties.smtpPassword = { type: "string", format: "password", title: "SMTP-Passwort", writeOnly: true };
  }
  if (category === "system") {
    properties.workerToken = { type: "string", format: "password", title: "Worker-Token", writeOnly: true };
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    title: `Mock ${CATEGORY_LABEL[category]}`,
    properties,
    additionalProperties: false,
  };
}

export function buildAdapterSettings(): AdapterConfigSettings[] {
  return ADAPTER_CATEGORIES.map((category) => {
    const secretFields: AdapterConfigSettings["secretFields"] = {};
    for (const field of adapterSecretFields(category)) secretFields[field] = { configured: true, maskedHint: "••••••" };
    return {
      adapterId: adapterIdFor(category),
      category,
      provider: adapterIdFor(category),
      enabled: true,
      config: { latencyMs: 0, errorRate: 0 },
      configSchema: adapterConfigSchema(category),
      secretFields,
    };
  });
}

export function buildSettings(ctx: SeedContext): Settings {
  return {
    version: 1,
    updatedAt: ctx.at(-2 * 86_400_000),
    profile: {
      displayName: "Erik Brandt",
      assistantName: "F.R.I.D.A.Y.",
      locale: "de",
      timeZone: "Europe/Berlin",
      dateFormat: "dd.MM.yyyy",
      timeFormat: "24h",
      firstDayOfWeek: "monday",
    },
    dashboard: { activeLayoutId: "default", fontScale: 1, backgroundGrid: true, soundEffects: false, autoRefreshSeconds: 30, compact: false },
    theme: { activeThemeId: "jarvis-navy-cyan", cyanIntensity: 1, panelOpacity: 0.72, goldIntensity: 1 },
    orb: defaultOrbSettings(),
    navigation: { order: NAVIGATION_ORDER, hidden: [], defaultPage: "overview", mode: "expanded" },
    modelsRouting: {
      defaultModel: "Kimi K3",
      localFirst: true,
      routes: [
        { taskKind: "mail-summary", model: "Qwen Local", reasoningLevel: "low", fallbackModel: "Kimi K3" },
        { taskKind: "research", model: "Kimi K3", reasoningLevel: "medium", fallbackModel: null },
        { taskKind: "coding", model: "Kimi K3", reasoningLevel: "high", fallbackModel: "Qwen Local" },
      ],
      monthlyBudgetEur: 150,
    },
    voice: {
      wakeWordEnabled: true,
      wakeWord: "Hey Jarvis",
      pushToTalkKey: "Ctrl+Space",
      speakerVerificationRequired: true,
      storeRawRecordings: false,
      voiceHistoryEnabled: true,
      ttsVoice: "de_DE-thorsten-medium",
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
        { kind: "phone", enabled: true, minPriority: "P0" },
        { kind: "email", enabled: true, minPriority: "P3" },
      ],
      quietHours: { enabled: true, from: "22:00", to: "07:00" },
      defaultEscalation: [
        { afterSeconds: 0, channel: "dashboard", description: "Sofort im Dashboard anzeigen", stopOnAcknowledge: true },
        { afterSeconds: 120, channel: "telegram", description: "Nach 2 Minuten per Telegram", stopOnAcknowledge: true },
        { afterSeconds: 300, channel: "whatsapp", description: "Nach 5 Minuten per WhatsApp", stopOnAcknowledge: true },
        { afterSeconds: 600, channel: "phone", description: "Nach 10 Minuten per Telefon", stopOnAcknowledge: true },
      ],
      snoozeDefaultMinutes: 30,
    },
    security: {
      sessionTimeoutMinutes: 480,
      reauthWindowMinutes: 5,
      allowRemoteAccess: false,
      auditHashChain: true,
      trustedOrigins: ["http://127.0.0.1:3100", "http://localhost:3000"],
    },
    approvals: { defaultExpiryMinutes: 60, draftOnlyByDefault: true, confirmTier2: true, reauthTier3: true, notifyOnRequest: true },
    dataRetention: { activityDays: 90, auditDays: 365, voiceHistoryDays: 30, notificationDays: 60, temporaryFileDays: 7, memoryDefaultTtlDays: null },
    backups: {
      enabled: true,
      schedule: "0 3 * * *",
      targetPath: "D:\\Jarvis\\Backups",
      retentionCount: 14,
      lastBackupAt: ctx.at(-5 * 3_600_000 - 15 * 60_000),
      lastBackupStatus: "success",
    },
    developer: { debugMode: false, showRawJson: false, scenarioConsole: true, orbPerfOverlay: false, logLevel: "info" },
    adapters: buildAdapterSettings(),
  };
}

function theme(id: string, name: string, description: string, tokens: Record<string, string>, glow: number): Theme {
  return {
    id,
    name,
    description,
    builtIn: true,
    tokens,
    orb: { preset: "gold-reference", particleDensity: 1, fragmentDensity: 1, glowIntensity: glow, motionSpeed: 1, mouseParallax: true },
    panels: { cornerStyle: "technical-cut", borderIntensity: 0.6, backgroundOpacity: 0.72 },
  };
}

export function buildThemes(): Theme[] {
  return [
    theme(
      "jarvis-navy-cyan",
      "F.R.I.D.A.Y. Navy & Cyan",
      "Standardthema: tiefes Navy, Cyan-HUD-Linien, goldener Orb.",
      {
        "color.background": "#050B14",
        "color.surface": "#0A1624",
        "color.border": "#1B4A5E",
        "color.primary": "#22D3EE",
        "color.accent.gold": "#F5B942",
        "color.text": "#E6F1FF",
        "color.textMuted": "#8CA3B8",
        "color.success": "#4ADE80",
        "color.warning": "#FB923C",
        "color.danger": "#F87171",
      },
      1,
    ),
    theme(
      "jarvis-deep-night",
      "F.R.I.D.A.Y. Tiefe Nacht",
      "Dunklere Variante mit reduziertem Cyan und kräftigerem Gold.",
      {
        "color.background": "#02060C",
        "color.surface": "#07101B",
        "color.border": "#143846",
        "color.primary": "#38BDF8",
        "color.accent.gold": "#FFC857",
        "color.text": "#DCE9F7",
        "color.textMuted": "#7A92A8",
        "color.success": "#34D399",
        "color.warning": "#F59E0B",
        "color.danger": "#EF4444",
      },
      0.9,
    ),
  ];
}

/** Widget ids are the canonical ones from config/layouts/jarvis-command-overview.json (the overview page resolves them by id). */
export function buildLayouts(): Layout[] {
  return [
    {
      layoutId: "default",
      name: "Standard",
      columns: 12,
      widgets: [
        { id: "core-overview", x: 0, y: 0, w: 3, h: 7, visible: true },
        { id: "ai-core-orb", x: 3, y: 0, w: 6, h: 7, visible: true },
        { id: "attention-feed", x: 9, y: 0, w: 3, h: 7, visible: true },
        { id: "active-agents", x: 0, y: 7, w: 5, h: 4, visible: true },
        { id: "mission-timeline", x: 5, y: 7, w: 4, h: 4, visible: true },
        { id: "quick-commands", x: 9, y: 7, w: 3, h: 4, visible: true },
        { id: "system-monitor", x: 0, y: 11, w: 4, h: 4, visible: true },
        { id: "memory-insights", x: 4, y: 11, w: 3, h: 4, visible: true },
        { id: "models-services", x: 7, y: 11, w: 5, h: 4, visible: true },
      ],
    },
    {
      layoutId: "kompakt",
      name: "Kompakt",
      columns: 12,
      widgets: [
        { id: "ai-core-orb", x: 0, y: 0, w: 8, h: 8, visible: true },
        { id: "attention-feed", x: 8, y: 0, w: 4, h: 8, visible: true },
        { id: "active-agents", x: 0, y: 8, w: 6, h: 4, visible: true },
        { id: "mission-timeline", x: 6, y: 8, w: 6, h: 4, visible: true },
      ],
    },
  ];
}
