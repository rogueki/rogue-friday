import type { AdapterError, AdapterRegistry, CallContext, PortCategory } from "@friday/adapter-core";
import { normalizeError } from "@friday/adapter-core";
import {
  CONTRACT_VERSION,
  type AdapterCategory,
  type AdapterInfo,
  type Approval,
  type AttentionItem,
  type CalendarEvent,
  type Health,
  type HealthStatus,
  type FridayStatus,
  type Notification,
  type OrbHealth,
  type OrbMode,
  type OrbSnapshot,
  type OrbStatus,
  type Overview,
  type QuickCommand,
  type Severity,
  type Task,
  type Thread,
  type OrbLayers,
} from "@friday/sdk";
import type { DataMode } from "@friday/config";
import { getCorrelationId } from "@friday/observability";
import type { MockWorld } from "@friday/mock-data";
import type { EventHub } from "../realtime/hub";
import { createCorrelationId } from "../util/ids";

export const CATEGORY_LABEL: Readonly<Record<AdapterCategory, string>> = {
  tasks: "Aufgaben",
  activity: "Live-Aktivität",
  memory: "Gedächtnis",
  agents: "Agenten",
  approvals: "Freigaben",
  communication: "E-Mail & Kommunikation",
  calendar: "Kalender",
  automations: "Automationen",
  research: "Recherche",
  files: "Dateien",
  voice: "Sprache",
  notifications: "Benachrichtigungen",
  system: "System",
  audit: "Audit",
  commands: "Befehle",
};

export const currentCall = (): CallContext => ({ correlationId: getCorrelationId() ?? createCorrelationId() });

const FINAL_TASK = new Set(["done", "failed", "cancelled"]);
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, error: 1, warning: 2, info: 3 };
const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };

export const DEFAULT_ASSISTANT_NAME = "F.R.I.D.A.Y.";

/**
 * Applies the configured assistant name to server-generated copy. Adapters (the mock world today) may still produce the
 * legacy "JARVIS" wording (the predecessor name) or the default brand "F.R.I.D.A.Y."; both are replaced, upper-cased for all-caps orb labels.
 */
export function brandText(text: string, assistantName: string): string {
  const loud = text === text.toUpperCase();
  return text.replace(/\{ASSISTANT\}|\bJARVIS\b|\bJarvis\b|F\.R\.I\.D\.A\.Y\./g, loud ? assistantName.toUpperCase() : assistantName);
}

const ORB_TEXT: Readonly<Record<OrbMode, string>> = {
  booting: "{ASSISTANT} WIRD INITIALISIERT",
  idle: "BEREIT",
  listening: "ICH HÖRE ZU",
  transcribing: "SPRACHE WIRD VERARBEITET",
  thinking: "ANALYSE",
  syncing: "SYNCHRONISIERUNG LÄUFT",
  working: "ARBEIT LÄUFT",
  speaking: "{ASSISTANT} SPRICHT",
  waiting_approval: "FREIGABE ERFORDERLICH",
  success: "ABGESCHLOSSEN",
  warning: "EINGESCHRÄNKTER BETRIEB",
  error: "FEHLER",
  offline: "OFFLINE",
  paused: "PAUSIERT",
};

export const QUICK_COMMANDS: readonly QuickCommand[] = [
  { id: "new-task", label: "Neue Aufgabe", icon: "plus-square", commandText: "Lege eine neue Aufgabe an: ", targetRoute: "/tasks", enabled: true, requiredCapability: "tasks.create", requiresConfirmation: true },
  { id: "summarize-mail", label: "Mails zusammenfassen", icon: "mail", commandText: "Fasse meine wichtigen E-Mails zusammen", targetRoute: "/communication", enabled: true, requiredCapability: "communication.read", requiresConfirmation: false },
  { id: "day-briefing", label: "Tagesbriefing", icon: "sun", commandText: "Erstelle mein Tagesbriefing", targetRoute: null, enabled: true, requiredCapability: "commands.execute", requiresConfirmation: false },
  { id: "today-events", label: "Termine heute", icon: "calendar", commandText: "Zeige meine Termine für heute", targetRoute: "/calendar", enabled: true, requiredCapability: "calendar.read", requiresConfirmation: false },
  { id: "search-memory", label: "Memory durchsuchen", icon: "brain", commandText: "Suche im Gedächtnis nach ", targetRoute: "/memory", enabled: true, requiredCapability: "memory.search", requiresConfirmation: false },
  { id: "system-check", label: "System-Check", icon: "activity", commandText: "Prüfe den Systemzustand", targetRoute: "/system", enabled: true, requiredCapability: "system.healthcheck", requiresConfirmation: false },
  { id: "start-research", label: "Recherche starten", icon: "search", commandText: "Recherchiere zum Thema: ", targetRoute: "/research", enabled: true, requiredCapability: "commands.execute", requiresConfirmation: true },
  { id: "pause-all", label: "Alles pausieren", icon: "pause", commandText: "Pausiere alle Aufgaben", targetRoute: null, enabled: true, requiredCapability: "commands.pause", requiresConfirmation: true },
];

const CAPABILITY_CATEGORY: Record<string, AdapterCategory> = {
  tasks: "tasks",
  activity: "activity",
  memory: "memory",
  agents: "agents",
  approvals: "approvals",
  mail: "communication",
  communication: "communication",
  calendar: "calendar",
  automations: "automations",
  research: "research",
  files: "files",
  voice: "voice",
  notifications: "notifications",
  system: "system",
  audit: "audit",
  commands: "commands",
};

// ---------------------------------------------------------------------------------------------------------------------
// Health / status
// ---------------------------------------------------------------------------------------------------------------------

export interface AdapterOverall {
  health: OrbHealth;
  summary: { online: number; degraded: number; offline: number };
}

export function summarizeAdapters(adapters: readonly AdapterInfo[]): AdapterOverall {
  const summary = { online: 0, degraded: 0, offline: 0 };
  const enabled = adapters.filter((adapter) => adapter.enabled);
  for (const adapter of adapters) {
    if (!adapter.enabled) continue;
    const status = adapter.health.status;
    if (status === "online") summary.online += 1;
    else if (status === "offline") summary.offline += 1;
    else summary.degraded += 1;
  }
  let health: OrbHealth = "online";
  if (enabled.length > 0 && summary.offline === enabled.length) health = "offline";
  else if (summary.degraded + summary.offline > 0) health = "degraded";
  return { health, summary };
}

export interface StatusServiceDeps {
  registry: AdapterRegistry;
  hub: EventHub;
  dataMode: DataMode;
  version: string;
  startedAt: Date;
  world: MockWorld | undefined;
  orbMode: () => OrbMode;
  now?: () => number;
  assistantName?: () => string;
}

export class StatusService {
  constructor(private readonly deps: StatusServiceDeps) {}

  /** Overall status for the top bar. Mock mode asks the world (it knows its scenario state); otherwise it is derived. */
  get(): FridayStatus {
    const { world, dataMode } = this.deps;
    if (world && dataMode === "mock") {
      world.refresh();
      const raw = world.fridayStatus();
      return { ...raw, label: brandText(raw.label, this.assistantName()), dataMode, eventStream: this.eventStream() };
    }
    const overall = summarizeAdapters(this.deps.registry.listAdapters());
    const now = (this.deps.now ?? Date.now)();
    return {
      status: overall.health,
      label: `${this.assistantName()} ${overall.health === "online" ? "online" : overall.health === "degraded" ? "eingeschränkt" : "offline"}`,
      mode: this.deps.orbMode(),
      dataMode,
      uptimeSeconds: Math.max(0, Math.round((now - this.deps.startedAt.getTime()) / 1000)),
      since: this.deps.startedAt.toISOString(),
      version: this.deps.version,
      eventStream: this.eventStream(),
      adapterSummary: overall.summary,
    };
  }

  private assistantName(): string {
    return this.deps.assistantName?.() ?? DEFAULT_ASSISTANT_NAME;
  }

  private eventStream(): FridayStatus["eventStream"] {
    const stats = this.deps.hub.stats();
    return { state: "online", roundtripMs: stats.clients > 0 ? 1 : null, lastEventAt: this.deps.hub.lastEventAt };
  }

  health(): Health {
    const adapters = this.deps.registry.listAdapters();
    const overall = summarizeAdapters(adapters);
    const status: HealthStatus = overall.health;
    return {
      contractVersion: CONTRACT_VERSION,
      status,
      checkedAt: new Date().toISOString(),
      components: [
        { id: "control-api", name: "Control API", status: "online", latencyMs: 1 },
        ...adapters.map((adapter) => ({
          id: adapter.manifest.id,
          name: adapter.manifest.name,
          status: adapter.enabled ? adapter.health.status : ("offline" as HealthStatus),
          latencyMs: adapter.health.latencyMs,
        })),
      ],
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Orb
// ---------------------------------------------------------------------------------------------------------------------

export interface OrbInputs {
  health: OrbHealth;
  nowMs: number;
  workingAgentIds: string[];
  runningTasks: Task[];
  pendingApprovals: Approval[];
  criticalOpen: Notification[];
  urgentOpen: Notification[];
  voiceMode: "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error";
  voicePaused?: boolean;
  audioLevel: number | undefined;
  degraded: string[];
  assistantName?: string;
}

/**
 * Derives the semantic orb state from live data (PLAN §17/§18.3). Priority: error > offline > waiting_approval >
 * listening/speaking > transcribing/thinking > working > warning > idle. Never guesses from free text.
 */
export function deriveOrb(input: OrbInputs, since: string): OrbSnapshot {
  const { health } = input;
  const nowIso = new Date(input.nowMs).toISOString();
  const focusTask = [...input.runningTasks].sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || a.id.localeCompare(b.id))[0];
  const contextBits: string[] = [];
  if (input.workingAgentIds.length > 0) {
    contextBits.push(`${input.workingAgentIds.length} ${input.workingAgentIds.length === 1 ? "Agent arbeitet" : "Agenten arbeiten"}`);
  }
  if (input.pendingApprovals.length > 0) {
    contextBits.push(`${input.pendingApprovals.length} Freigabe${input.pendingApprovals.length === 1 ? "" : "n"} offen`);
  }
  if (input.degraded.length > 0) contextBits.push(input.degraded.join(", "));

  const voiceLayer: OrbLayers["voice"] =
    input.voiceMode === "listening" || input.voiceMode === "transcribing" || input.voiceMode === "speaking" ? input.voiceMode : "idle";
  const layers: OrbLayers = {
    voice: voiceLayer,
    work:
      input.voiceMode === "thinking"
        ? "thinking"
        : input.workingAgentIds.length > 0 || input.runningTasks.length > 0
          ? "working"
          : "idle",
    attention:
      input.criticalOpen.length > 0 || input.voiceMode === "error"
        ? "error"
        : input.pendingApprovals.length > 0
          ? "waiting_approval"
          : input.urgentOpen.length > 0 || health !== "online"
            ? "warning"
            : "none",
    health,
    activeAgentIds: input.workingAgentIds.slice(0, 24),
  };

  const done = (mode: OrbMode, extra: Partial<OrbStatus> = {}): OrbSnapshot => ({
    status: {
      mode,
      activityText: brandText(ORB_TEXT[mode], input.assistantName ?? DEFAULT_ASSISTANT_NAME),
      progress: null,
      progressMode: "none",
      urgency: "none",
      health,
      activeAgentCount: input.workingAgentIds.length,
      since,
      ...extra,
    },
    layers,
  });

  if (input.criticalOpen.length > 0) {
    return done("error", { detailText: [input.criticalOpen[0]?.title, ...contextBits].filter(Boolean).join(" · "), urgency: "critical" });
  }
  if (input.voiceMode === "error") return done("error", { detailText: "Sprachpipeline meldet einen Fehler", urgency: "critical" });
  if (health === "offline") return done("offline", { detailText: "Alle Adapter nicht erreichbar", urgency: "critical" });
  if (input.pendingApprovals.length > 0) {
    const top = input.pendingApprovals[0] as Approval;
    return done("waiting_approval", {
      detailText: [top.action, input.pendingApprovals.length > 1 ? `${input.pendingApprovals.length} Freigaben offen` : null].filter(Boolean).join(" · "),
      approvalId: top.id,
      urgency: input.pendingApprovals.some((approval) => approval.riskTier === 3) ? "warning" : "info",
      ...(top.taskId ? { taskId: top.taskId } : {}),
    });
  }
  if (input.voiceMode === "listening" || input.voiceMode === "speaking") {
    return done(input.voiceMode, { ...(input.audioLevel !== undefined ? { audioLevel: input.audioLevel } : {}), ...(contextBits.length ? { detailText: contextBits.join(" · ") } : {}) });
  }
  if (input.voiceMode === "transcribing") return done("transcribing", contextBits.length ? { detailText: contextBits.join(" · ") } : {});
  if (input.voiceMode === "thinking") return done("thinking", contextBits.length ? { detailText: contextBits.join(" · ") } : {});
  if (input.voicePaused) return done("paused", contextBits.length ? { detailText: contextBits.join(" · ") } : {});
  if (input.workingAgentIds.length > 0 || input.runningTasks.length > 0) {
    const determinate = focusTask?.progress.mode === "determinate" && typeof focusTask.progress.value === "number";
    return done("working", {
      detailText: [focusTask?.title, input.runningTasks.length > 1 ? `${input.runningTasks.length} Aufgaben laufen` : null].filter(Boolean).join(" · "),
      progress: determinate ? (focusTask?.progress.value ?? null) : null,
      progressMode: determinate ? "determinate" : "indeterminate",
      urgency: input.degraded.length > 0 ? "warning" : "none",
      ...(focusTask ? { taskId: focusTask.id } : {}),
    });
  }
  if (input.urgentOpen.length > 0 || health === "degraded") {
    return done("warning", {
      urgency: "warning",
      detailText: [input.urgentOpen[0]?.title, input.degraded.join(", ") || undefined].filter(Boolean).join(" · "),
    });
  }
  void nowIso;
  return done("idle");
}

export interface OrbServiceDeps {
  registry: AdapterRegistry;
  world: MockWorld | undefined;
  dataMode: DataMode;
  now?: () => number;
  assistantName?: () => string;
}

export class OrbService {
  private lastMode: OrbMode = "idle";
  private since = new Date().toISOString();

  constructor(private readonly deps: OrbServiceDeps) {}

  get mode(): OrbMode {
    return this.lastMode;
  }

  /** Prefers an adapter-provided snapshot (mock world today); otherwise derives it from the other ports. */
  async snapshot(call: CallContext = currentCall()): Promise<OrbSnapshot> {
    const { world, dataMode } = this.deps;
    const assistantName = this.deps.assistantName?.() ?? DEFAULT_ASSISTANT_NAME;
    const raw = world && dataMode === "mock" ? world.orbSnapshot() : await this.derive(call, assistantName);
    const snapshot: OrbSnapshot = {
      ...raw,
      status: {
        ...raw.status,
        ...(raw.status.activityText !== undefined ? { activityText: brandText(raw.status.activityText, assistantName) } : {}),
      },
    };
    if (snapshot.status.mode !== this.lastMode) {
      this.lastMode = snapshot.status.mode;
      this.since = snapshot.status.since;
    }
    return snapshot;
  }

  private async derive(call: CallContext, assistantName: string): Promise<OrbSnapshot> {
    const { registry } = this.deps;
    const adapters = registry.listAdapters();
    const overall = summarizeAdapters(adapters);
    const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch {
        return fallback;
      }
    };
    const [agents, tasks, approvals, notifications, voice] = await Promise.all([
      safe(() => registry.getPort("agents").listAgents({ status: ["working"], limit: 50 }, call), null),
      safe(() => registry.getPort("tasks").listTasks({ status: ["running"], limit: 50 }, call), null),
      safe(() => registry.getPort("approvals").listApprovals({ status: ["pending"], limit: 50 }, call), null),
      safe(() => registry.getPort("notifications").listNotifications({ priority: ["P0", "P1"], status: ["open"], limit: 50 }, call), null),
      safe(() => registry.getPort("voice").getVoiceStatus({}, call), null),
    ]);
    const nowMs = (this.deps.now ?? Date.now)();
    const open = notifications?.items ?? [];
    const snapshot = deriveOrb(
      {
        health: overall.health,
        nowMs,
        assistantName,
        workingAgentIds: (agents?.items ?? []).map((agent) => agent.id),
        runningTasks: tasks?.items ?? [],
        pendingApprovals: (approvals?.items ?? []).filter((approval) => approval.expiresAt === null || Date.parse(approval.expiresAt) > nowMs),
        criticalOpen: open.filter((n) => n.priority === "P0"),
        urgentOpen: open.filter((n) => n.priority === "P1"),
        voiceMode: voice?.data.mode ?? "idle",
        voicePaused: voice?.data.microphone.state === "muted",
        audioLevel: voice?.data.microphone.inputLevel,
        degraded: adapters
          .filter((adapter) => adapter.enabled && adapter.health.status !== "online")
          .map((adapter) => `${CATEGORY_LABEL[adapter.manifest.category]} ${adapter.health.status === "offline" ? "offline" : "eingeschränkt"}`),
      },
      this.since,
    );
    if (snapshot.status.mode !== this.lastMode) snapshot.status.since = new Date(nowMs).toISOString();
    return snapshot;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Overview (PLAN §27.14, §27.16: partial failure never fails the whole call)
// ---------------------------------------------------------------------------------------------------------------------

export interface OverviewResult {
  overview: Overview;
  /** How many of the data sections failed outright (used for the envelope's freshness). */
  failedSections: number;
}

export interface OverviewServiceDeps {
  registry: AdapterRegistry;
  status: StatusService;
  orb: OrbService;
  capabilityEnabled: (capability: string) => boolean;
  now?: () => number;
}

/**
 * "offline" = the section's source cannot be reached right now; "degraded" = it answers, but slowly or with errors.
 * A refused connection or an open circuit breaker (`ADAPTER_UNAVAILABLE` without an upstream HTTP status) is offline no
 * matter what the health monitor currently says: its cadence (default 15 s, three failed checks before OFFLINE) lags
 * behind the first failing call, and the same outage must not flip offline -> degraded -> offline while it lasts.
 */
export function sectionStatusOf(error: AdapterError, info: AdapterInfo | undefined): "degraded" | "offline" {
  if (error.code === "ADAPTER_TIMEOUT") return "degraded";
  if (error.code === "ADAPTER_UNAVAILABLE" && error.details.upstreamStatus === undefined) return "offline";
  return info?.health.status === "degraded" ? "degraded" : "offline";
}

export class OverviewService {
  constructor(private readonly deps: OverviewServiceDeps) {}

  async build(call: CallContext = currentCall()): Promise<OverviewResult> {
    const { registry } = this.deps;
    const degraded: Overview["degradedSections"] = [];
    const nowMs = (this.deps.now ?? Date.now)();
    const nowIso = new Date(nowMs).toISOString();
    const infoByCategory = new Map<string, AdapterInfo>(registry.listAdapters().map((info) => [info.manifest.category, info]));

    let failed = 0;
    const section = async <T>(category: PortCategory, fallback: T, load: () => Promise<T>): Promise<T> => {
      try {
        return await load();
      } catch (raw) {
        failed += 1;
        const error = normalizeError(raw);
        const info = infoByCategory.get(category);
        degraded.push({
          section: CATEGORY_LABEL[category],
          adapterId: info?.manifest.id ?? `unconfigured-${category}`,
          status: sectionStatusOf(error, info),
          reason: error.code === "CAPABILITY_MISSING" && !info ? "Kein Adapter konfiguriert." : error.message,
        });
        return fallback;
      }
    };

    const port = <C extends PortCategory>(category: C) => registry.getPort(category);

    const [agents, tasks, openTasks, approvals, alerts, mail, events, metrics, services, models, storage, voice, memory] = await Promise.all([
      section("agents", [], async () => (await port("agents").listAgents({ status: ["working"], limit: 12 }, call)).items),
      section("tasks", [], async () => (await port("tasks").listTasks({ status: ["running"], limit: 10, sort: "priority" }, call)).items),
      section("tasks", null, async () => {
        const page = await port("tasks").listTasks({ status: ["triage", "todo", "ready", "running", "waiting", "review"], limit: 200 }, call);
        return page;
      }),
      section("approvals", [], async () => (await port("approvals").listApprovals({ status: ["pending"], limit: 50 }, call)).items),
      section("notifications", [], async () => (await port("notifications").listNotifications({ priority: ["P0", "P1", "P2"], status: ["open"], limit: 50 }, call)).items),
      section("communication", [], async () => (await port("communication").listThreads({ needsReply: true, limit: 200 }, call)).items),
      section("calendar", [], async () => (await port("calendar").listCalendarEvents({ from: nowIso, limit: 20 }, call)).items),
      section("system", null, async () => (await port("system").getSystemMetrics({}, call)).data),
      section("system", [], async () => (await port("system").listServices({ limit: 50 }, call)).items),
      section("system", [], async () => (await port("system").listModelProviders({ limit: 50 }, call)).items),
      section("system", [], async () => (await port("system").listStorageVolumes({ limit: 50 }, call)).items),
      section("voice", null, async () => (await port("voice").getVoiceStatus({}, call)).data),
      section("memory", null, async () => {
        const page = await port("memory").listMemory({ limit: 200 }, call);
        return { total: page.pageInfo.totalCount ?? page.items.length, items: page.items };
      }),
    ]);

    // The failed-section list repeats "System" once per call; keep one entry per adapter.
    const seen = new Set<string>();
    const uniqueDegraded = degraded.filter((entry) => (seen.has(entry.adapterId) ? false : (seen.add(entry.adapterId), true)));
    degraded.length = 0;
    degraded.push(...uniqueDegraded);
    for (const info of infoByCategory.values()) {
      if (degraded.some((entry) => entry.adapterId === info.manifest.id)) continue;
      if (!info.enabled || info.health.status !== "online") {
        degraded.push({
          section: CATEGORY_LABEL[info.manifest.category],
          adapterId: info.manifest.id,
          status: !info.enabled || info.health.status === "offline" ? "offline" : "degraded",
          reason: !info.enabled ? "Adapter ist deaktiviert." : (info.health.lastError?.message ?? "Adapter nicht vollständig verfügbar."),
        });
      }
    }

    const importantMail = (mail as Thread[]).filter(
      (thread) => thread.needsReply && (PRIORITY_RANK[thread.priority] ?? 9) <= 2 && thread.channelKind === "email" && thread.status !== "archived",
    );
    const urgent = (alerts as Notification[]).filter((n) => n.priority === "P0" || n.priority === "P1").sort(
      (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || b.createdAt.localeCompare(a.createdAt),
    );
    const nextEvents = (events as CalendarEvent[])
      .filter((event) => event.status !== "cancelled" && Date.parse(event.end) > nowMs)
      .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
      .slice(0, 5);

    const attention: AttentionItem[] = [];
    for (const n of urgent) {
      attention.push({ id: n.id, kind: "alert", title: n.title, summary: n.body, severity: n.priority === "P0" ? "critical" : "warning", occurredAt: n.createdAt, targetRoute: n.targetRoute ?? `/alerts?notification=${n.id}`, ref: { type: "notification", id: n.id, label: n.title } });
    }
    for (const approval of approvals as Approval[]) {
      attention.push({ id: approval.id, kind: "approval", title: approval.action, summary: approval.rationale.split("\n\n")[0] ?? approval.rationale, severity: approval.riskTier === 3 ? "warning" : "info", occurredAt: approval.createdAt, targetRoute: `/approvals?approval=${approval.id}`, ref: { type: "approval", id: approval.id, label: approval.action } });
    }
    for (const task of openTasks?.items ?? []) {
      if (task.status === "waiting" && task.blockers.some((blocker) => blocker.kind === "input_needed")) {
        attention.push({ id: task.id, kind: "blocked_task", title: task.title, summary: task.blockers[0]?.description ?? "Aufgabe ist blockiert.", severity: "warning", occurredAt: task.updatedAt, targetRoute: `/tasks?task=${task.id}`, ref: { type: "task", id: task.id, label: task.title } });
      } else if (!FINAL_TASK.has(task.status) && task.dueAt !== null && Date.parse(task.dueAt) < nowMs) {
        attention.push({ id: task.id, kind: "overdue_task", title: task.title, summary: "Die Frist ist überschritten.", severity: "warning", occurredAt: task.dueAt, targetRoute: `/tasks?task=${task.id}`, ref: { type: "task", id: task.id, label: task.title } });
      }
    }
    for (const thread of importantMail.filter((candidate) => candidate.priority === "P1")) {
      attention.push({ id: thread.id, kind: "mail", title: thread.subject, summary: thread.summary ?? "Antwort erforderlich.", severity: "warning", occurredAt: thread.lastMessageAt, targetRoute: `/communication?thread=${thread.id}`, ref: { type: "thread", id: thread.id, label: thread.subject } });
    }
    for (const entry of degraded) {
      attention.push({ id: entry.adapterId, kind: "system", title: `${entry.section} eingeschränkt`, summary: entry.reason, severity: entry.status === "degraded" ? "warning" : "error", occurredAt: nowIso, targetRoute: "/system", ref: { type: "adapter", id: entry.adapterId, label: entry.section } });
    }
    attention.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));

    const dataVolume = storage.find((volume) => volume.mount.startsWith("D:")) ?? storage[0];
    const memoryItems = memory?.items ?? [];
    const orb = await this.deps.orb.snapshot(call);
    const activeMode = ["working", "syncing", "thinking", "transcribing", "speaking", "listening"].includes(orb.status.mode);
    const openTaskCount = openTasks ? (openTasks.pageInfo.totalCount ?? openTasks.items.length) : 0;

    const overview: Overview = {
      friday: this.deps.status.get(),
      orb,
      currentActivity: activeMode
        ? { text: orb.status.activityText ?? "", agentId: orb.status.currentAgentId ?? null, taskId: orb.status.taskId ?? null, since: orb.status.since }
        : null,
      activeAgents: agents,
      runningTasks: tasks,
      openApprovals: (approvals as Approval[]).slice(0, 10),
      criticalAlerts: urgent.slice(0, 10),
      attention: attention.slice(0, 12),
      importantMailCount: importantMail.length,
      nextEvents,
      systemSummary: {
        cpuPercent: metrics?.cpu.usagePercent ?? null,
        ramPercent: metrics?.ram.usagePercent ?? null,
        gpuPercent: metrics?.gpu?.usagePercent ?? null,
        vramPercent: metrics?.vram?.usagePercent ?? null,
        storageUsedPercent: dataVolume?.usagePercent ?? null,
        services: services.map((service) => ({ id: service.id, name: service.name, status: service.status })),
      },
      models,
      voice,
      memoryInsights: memory
        ? {
            total: memory.total,
            newToday: memoryItems.filter((item) => nowMs - Date.parse(item.createdAt) < 86_400_000).length,
            lastUpdatedAt: memoryItems.reduce<string | null>((latest, item) => (latest === null || item.updatedAt > latest ? item.updatedAt : latest), null),
          }
        : null,
      counters: {
        tasks: openTaskCount,
        approvals: (approvals as Approval[]).length,
        mail: importantMail.length,
        alerts: (alerts as Notification[]).length,
      },
      quickCommands: QUICK_COMMANDS.map((command) => this.quickCommand(command, infoByCategory)),
      degradedSections: degraded,
      lastUpdatedAt: nowIso,
    };
    return { overview, failedSections: failed };
  }

  private quickCommand(command: QuickCommand, infoByCategory: Map<string, AdapterInfo>): QuickCommand {
    const [moduleName] = command.requiredCapability.split(".") as [string];
    const category = CAPABILITY_CATEGORY[moduleName];
    const info = category ? infoByCategory.get(category) : undefined;
    const capabilityOk = this.deps.capabilityEnabled(command.requiredCapability);
    const adapterOk = !category || (info !== undefined && info.enabled && info.health.status !== "offline");
    const enabled = capabilityOk && adapterOk;
    const { disabledReason: _old, ...rest } = command;
    return {
      ...rest,
      enabled,
      ...(enabled
        ? {}
        : { disabledReason: !adapterOk && category ? `${CATEGORY_LABEL[category]} ist derzeit nicht verfügbar.` : "Diese Funktion wird vom Adapter nicht angeboten." }),
    };
  }
}
