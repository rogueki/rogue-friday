import {
  CONTRACT_VERSION,
  type ActionResult,
  type AdapterCategory,
  type AdapterHealth,
  type AdapterInfo,
  type AdapterLogEntry,
  type AttentionItem,
  type Capabilities,
  type CalendarEvent,
  type Health,
  type FridayStatus,
  type Meta,
  type OrbSnapshot,
  type Overview,
  type Severity,
  type Task,
} from "@friday/sdk";
import { CATEGORY_LABEL, MODULE_CATEGORY, isCapabilityModule } from "../../core/constants";
import { notFound, validationFailed } from "../../core/errors";
import { clone, compareAsc, priorityRank, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { pageOf, type Query } from "./shared";

const LOG_LEVEL_RANK: Record<AdapterLogEntry["level"], number> = { debug: 0, info: 1, warn: 2, error: 3 };
/** Simulated duration of an adapter restart on the world clock. */
const RESTART_MS = 1_500;

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, error: 1, warning: 2, info: 3 };
const FINAL: Task["status"][] = ["done", "failed", "cancelled"];

export class MetaService {
  constructor(private readonly w: MockWorld) {}

  getMeta(): Meta {
    return {
      contractVersion: CONTRACT_VERSION,
      apiVersion: "v1",
      dataMode: "mock",
      eventsPath: "/api/v1/events",
      buildVersion: "1.0.0+mock",
      features: { devScenarios: this.w.state.settings.developer.scenarioConsole, scenarioControls: true, rawJsonView: this.w.state.settings.developer.showRawJson, mockData: true, eventReplay: true, ...this.w.state.uiHints },
      serverTime: this.w.nowIso(),
      defaultLocale: this.w.state.settings.profile.locale,
    };
  }

  getHealth(): Health {
    const status = this.w.fridayStatus().status;
    return {
      contractVersion: CONTRACT_VERSION,
      status,
      checkedAt: this.w.nowIso(),
      components: [
        { id: "control-api", name: "Control API", status: "online", latencyMs: 8 },
        ...this.w.state.adapters.map((adapter) => {
          const health = this.w.adapterHealth(adapter.category);
          return { id: adapter.manifest.id, name: adapter.manifest.name, status: health.status, latencyMs: health.latencyMs };
        }),
      ],
    };
  }

  getCapabilities(): Capabilities {
    return clone(this.w.state.capabilities);
  }

  listAdapters(query: Query<"listAdapters"> = {}): Page<AdapterInfo> {
    const infos: AdapterInfo[] = this.w.state.adapters.map((adapter) => ({
      manifest: clone(adapter.manifest),
      health: this.w.adapterHealth(adapter.category),
      enabled: adapter.enabled,
      provider: adapter.provider,
      mode: "mock",
    }));
    return pageOf(infos, query);
  }

  getAdapterHealth(id: string): AdapterHealth {
    const adapter = this.w.state.adapters.find((candidate) => candidate.manifest.id === id);
    if (!adapter) throw notFound("Adapter", id);
    return this.w.adapterHealth(adapter.category);
  }

  /** Recent log lines of one adapter (newest last), optionally from a minimum level. */
  listAdapterLogs(id: string, query: { limit?: number | string; level?: string } = {}): { items: AdapterLogEntry[] } {
    return this.w.read("getAdapterLogs", () => {
      this.adapterById(id);
      const limit = query.limit === undefined || query.limit === "" ? 100 : Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw validationFailed("limit muss zwischen 1 und 500 liegen.", [{ path: "limit", message: "1..500" }]);
      const level = (query.level ?? "debug") as AdapterLogEntry["level"];
      if (!(level in LOG_LEVEL_RANK)) throw validationFailed(`Ungültiger Wert für level: ${level}.`, [{ path: "level", message: "erlaubt: debug, info, warn, error" }]);
      const lines = this.w.state.adapterLogs.filter((entry) => entry.adapterId === id && LOG_LEVEL_RANK[entry.level] >= LOG_LEVEL_RANK[level]);
      return { items: clone(lines.slice(-limit)) };
    });
  }

  /**
   * Restarts an adapter: it goes `recovering` right away and is `online` again after a short simulated start-up. The
   * Control API does the real thing through the adapter registry; this keeps the standalone mock behaving alike.
   */
  restartAdapter(id: string, ctx?: OpContext): ActionResult {
    return this.w.run("restartAdapter", ctx, { id }, () => {
      const adapter = this.adapterById(id);
      const correlationId = this.w.correlationId(ctx);
      this.w.logAdapter(adapter.manifest.id, "info", "Neustart angefordert", { by: this.w.actorOf(ctx).id }, correlationId);
      this.w.setAdapterState(adapter.category, "recovering", { reason: "Adapter wird neu gestartet" });
      this.w.clock.setTimeout(() => {
        this.w.logAdapter(adapter.manifest.id, "info", "Adapter neu gestartet", {}, correlationId);
        this.w.setAdapterState(adapter.category, "online");
      }, RESTART_MS);
      const audit = this.w.recordAudit({
        category: "system",
        action: "adapter.restarted",
        severity: "warning",
        correlationId,
        adapterId: adapter.manifest.id,
        actor: this.w.actorOf(ctx),
        after: { adapterId: adapter.manifest.id },
      });
      return { contractVersion: CONTRACT_VERSION, accepted: true, status: "queued", correlationId, resourceId: adapter.manifest.id, auditEventId: audit.id, message: `Adapter „${adapter.manifest.name}“ wird neu gestartet.` };
    });
  }

  private adapterById(id: string): MockWorld["state"]["adapters"][number] {
    const adapter = this.w.state.adapters.find((candidate) => candidate.manifest.id === id);
    if (!adapter) throw notFound("Adapter", id);
    return adapter;
  }

  getStatus(): FridayStatus {
    this.w.refresh();
    return this.w.fridayStatus();
  }

  getOrb(): OrbSnapshot {
    return this.w.orbSnapshot();
  }

  /** Adapter data is usable unless the adapter is offline, reconnecting, timing out or disabled. */
  available(category: AdapterCategory): boolean {
    const adapter = this.w.adapter(category);
    return adapter.enabled && (adapter.mode === "online" || adapter.mode === "degraded");
  }

  /**
   * Aggregated home payload (PLAN §27.14). Sections of unavailable adapters are emptied and reported in
   * `degradedSections` so the page stays usable during partial outages.
   */
  getOverview(): Overview {
    const w = this.w;
    const s = w.state;
    const now = w.nowMs();
    const orb = w.orbSnapshot();
    const avail = (category: AdapterCategory): boolean => this.available(category);

    const workingAgents = avail("agents") ? s.agents.filter((agent) => agent.status === "working") : [];
    const runningTasks = avail("tasks")
      ? s.tasks.filter((task) => task.status === "running").sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || compareAsc(a.startedAt ?? "", b.startedAt ?? "") || compareAsc(a.id, b.id))
      : [];
    const openApprovals = avail("approvals")
      ? s.approvals.filter((approval) => approval.status === "pending").sort((a, b) => compareAsc(a.expiresAt ?? "9", b.expiresAt ?? "9") || compareAsc(a.id, b.id))
      : [];
    const urgent = avail("notifications")
      ? s.notifications.filter((n) => (n.priority === "P0" || n.priority === "P1") && n.status === "open").sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.createdAt.localeCompare(a.createdAt))
      : [];
    const importantMail = avail("communication") ? s.threads.filter((thread) => thread.needsReply && priorityRank(thread.priority) <= 2 && thread.channelKind === "email" && thread.status !== "archived") : [];
    const nextEvents: CalendarEvent[] = avail("calendar")
      ? s.calendarEvents.filter((event) => event.status !== "cancelled" && Date.parse(event.end) > now).sort((a, b) => compareAsc(a.start, b.start) || compareAsc(a.id, b.id)).slice(0, 5)
      : [];

    const attention: AttentionItem[] = [];
    for (const n of urgent) {
      attention.push({ id: n.id, kind: "alert", title: n.title, summary: n.body, severity: n.priority === "P0" ? "critical" : "warning", occurredAt: n.createdAt, targetRoute: n.targetRoute ?? `/alerts?notification=${n.id}`, ref: { type: "notification", id: n.id, label: n.title } });
    }
    for (const approval of openApprovals) {
      attention.push({ id: approval.id, kind: "approval", title: approval.action, summary: approval.rationale.split("\n\n")[0] ?? approval.rationale, severity: approval.riskTier === 3 ? "warning" : "info", occurredAt: approval.createdAt, targetRoute: `/approvals?approval=${approval.id}`, ref: { type: "approval", id: approval.id, label: approval.action } });
    }
    if (avail("tasks")) {
      for (const task of s.tasks) {
        if (task.status === "waiting" && task.blockers.some((blocker) => blocker.kind === "input_needed")) {
          attention.push({ id: task.id, kind: "blocked_task", title: task.title, summary: task.blockers[0]?.description ?? "Aufgabe ist blockiert.", severity: "warning", occurredAt: task.updatedAt, targetRoute: `/tasks?task=${task.id}`, ref: { type: "task", id: task.id, label: task.title } });
        } else if (!FINAL.includes(task.status) && task.dueAt !== null && Date.parse(task.dueAt) < now) {
          attention.push({ id: task.id, kind: "overdue_task", title: task.title, summary: "Die Frist ist überschritten.", severity: "warning", occurredAt: task.dueAt, targetRoute: `/tasks?task=${task.id}`, ref: { type: "task", id: task.id, label: task.title } });
        }
      }
    }
    for (const thread of importantMail.filter((candidate) => candidate.priority === "P1")) {
      attention.push({ id: thread.id, kind: "mail", title: thread.subject, summary: thread.summary ?? "Antwort erforderlich.", severity: "warning", occurredAt: thread.lastMessageAt, targetRoute: `/communication?thread=${thread.id}`, ref: { type: "thread", id: thread.id, label: thread.subject } });
    }
    for (const adapter of s.adapters.filter((candidate) => candidate.mode !== "online")) {
      attention.push({ id: adapter.manifest.id, kind: "system", title: `${CATEGORY_LABEL[adapter.category]} eingeschränkt`, summary: adapter.lastError?.message ?? "Der Adapter ist nicht vollständig verfügbar.", severity: adapter.mode === "degraded" ? "warning" : "error", occurredAt: adapter.lastSyncedAt, targetRoute: "/system", ref: { type: "adapter", id: adapter.manifest.id, label: adapter.manifest.name } });
    }
    attention.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));

    const systemAvailable = avail("system");
    const metrics = systemAvailable ? w.currentMetrics() : null;
    const dataVolume = s.system.storage.find((volume) => volume.mount.startsWith("D:")) ?? s.system.storage[0];
    const memoryAvailable = avail("memory");
    const newestMemory = memoryAvailable ? s.memory.reduce<string | null>((latest, memory) => (latest === null || memory.updatedAt > latest ? memory.updatedAt : latest), null) : null;
    const openTasks = avail("tasks") ? s.tasks.filter((task) => !FINAL.includes(task.status)).length : 0;
    const alertCount = avail("notifications") ? s.notifications.filter((n) => n.status === "open" && priorityRank(n.priority) <= 2).length : 0;

    const degradedSections: Overview["degradedSections"] = s.adapters
      .filter((adapter) => adapter.mode !== "online" || !adapter.enabled)
      .map((adapter) => ({
        section: CATEGORY_LABEL[adapter.category],
        adapterId: adapter.manifest.id,
        status: adapter.mode === "degraded" ? ("degraded" as const) : ("offline" as const),
        reason: !adapter.enabled ? "Adapter ist deaktiviert." : (adapter.lastError?.message ?? "Adapter nicht erreichbar."),
      }));

    const activeMode = ["working", "syncing", "thinking", "transcribing", "speaking", "listening"].includes(orb.status.mode);

    return {
      friday: w.fridayStatus(),
      orb,
      currentActivity: activeMode
        ? { text: orb.status.activityText ?? "", agentId: orb.status.currentAgentId ?? null, taskId: orb.status.taskId ?? null, since: orb.status.since }
        : null,
      activeAgents: clone(workingAgents.slice(0, 12)),
      runningTasks: clone(runningTasks.slice(0, 10)),
      openApprovals: clone(openApprovals.slice(0, 10)),
      criticalAlerts: clone(urgent.slice(0, 10)),
      attention: attention.slice(0, 12),
      importantMailCount: importantMail.length,
      nextEvents: clone(nextEvents),
      systemSummary: {
        cpuPercent: metrics?.cpu.usagePercent ?? null,
        ramPercent: metrics?.ram.usagePercent ?? null,
        gpuPercent: metrics?.gpu?.usagePercent ?? null,
        vramPercent: metrics?.vram?.usagePercent ?? null,
        storageUsedPercent: systemAvailable ? (dataVolume?.usagePercent ?? null) : null,
        services: systemAvailable ? s.system.services.map((service) => ({ id: service.id, name: service.name, status: service.status })) : [],
      },
      models: systemAvailable ? clone(s.system.models) : [],
      voice: avail("voice") ? clone(s.voice.status) : null,
      memoryInsights: memoryAvailable
        ? { total: s.memory.length, newToday: s.memory.filter((memory) => now - Date.parse(memory.createdAt) < 86_400_000).length, lastUpdatedAt: newestMemory }
        : null,
      counters: { tasks: openTasks, approvals: openApprovals.length, mail: importantMail.length, alerts: alertCount },
      quickCommands: s.quickCommands.map((command) => {
        const [moduleName, capability] = command.requiredCapability.split(".") as [string, string];
        const flags = isCapabilityModule(moduleName) ? (s.capabilities.modules[moduleName] as unknown as Record<string, unknown>) : undefined;
        const capabilityOk = flags ? flags[capability] !== false : true;
        const category = isCapabilityModule(moduleName) ? MODULE_CATEGORY[moduleName] : undefined;
        const adapterOk = category ? avail(category) : true;
        const enabled = capabilityOk && adapterOk;
        const { disabledReason: _old, ...rest } = command;
        return {
          ...rest,
          enabled,
          ...(enabled ? {} : { disabledReason: !capabilityOk ? "Diese Funktion wird vom Adapter nicht angeboten." : `${CATEGORY_LABEL[category as AdapterCategory]} ist derzeit nicht verfügbar.` }),
        };
      }),
      degradedSections,
      lastUpdatedAt: w.nowIso(),
    };
  }
}
