import type { Agent, Overview, OverviewResponse, Task } from "@friday/sdk";

const SOURCE = { adapterId: "mock-core", system: "mock", lastSyncedAt: "2026-10-14T08:00:00Z" } as const;
const NOW = "2026-10-14T08:15:00Z";

export function makeAgent(partial: Partial<Agent> = {}): Agent {
  return {
    id: "agent_01JAAAAAAAAAAAAAAAAAAAAAAA",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    source: SOURCE,
    name: "Coding-Agent",
    role: "Entwicklung",
    status: "working",
    currentTaskId: null,
    model: "Kimi K3",
    reasoningLevel: "medium",
    capabilities: [],
    activeTools: [],
    startedAt: NOW,
    runtimeMs: 1000,
    heartbeatAt: NOW,
    successRate: 0.9,
    performance: { avgTaskDurationMs: 1000, tasksCompleted: 3, tasksFailed: 0 },
    lastActivityAt: NOW,
    lastError: null,
    ...partial,
  };
}

export function makeTask(partial: Partial<Task> = {}): Task {
  return {
    id: "task_01JAAAAAAAAAAAAAAAAAAAAAAA",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    source: SOURCE,
    title: "Wettbewerbsanalyse",
    status: "running",
    priority: "P2",
    agentId: null,
    model: null,
    progress: { mode: "determinate", value: 0.4 },
    startedAt: NOW,
    runtimeMs: 1000,
    dueAt: null,
    estimatedCompletionAt: null,
    blockers: [],
    lastActivityAt: NOW,
    artifactCount: 0,
    artifacts: [],
    steps: [],
    toolCalls: [],
    sourceRefs: [],
    approvalIds: [],
    errors: [],
    createdBy: { type: "user", id: "user_1" },
    ...partial,
  };
}

export function makeOverview(partial: Partial<Overview> = {}): Overview {
  return {
    friday: {
      status: "online",
      label: "Optimal",
      mode: "idle",
      dataMode: "mock",
      uptimeSeconds: 100,
      since: NOW,
      version: "1.0.0",
      eventStream: { state: "online", roundtripMs: 20, lastEventAt: NOW },
      adapterSummary: { online: 5, degraded: 0, offline: 0 },
    },
    orb: {
      status: { mode: "idle", since: NOW },
      layers: { voice: "idle", work: "idle", attention: "none", health: "online", activeAgentIds: [] },
    },
    currentActivity: null,
    activeAgents: [makeAgent()],
    runningTasks: [],
    openApprovals: [],
    criticalAlerts: [],
    attention: [
      { id: "att_1", kind: "approval", title: "Freigabe wartet", summary: "E-Mail senden", severity: "warning", occurredAt: NOW, targetRoute: "/approvals", ref: null },
    ],
    importantMailCount: 0,
    nextEvents: [],
    systemSummary: { cpuPercent: 15, ramPercent: 54, gpuPercent: null, vramPercent: null, storageUsedPercent: 40, services: [] },
    models: [],
    voice: null,
    memoryInsights: { total: 10, newToday: 1, lastUpdatedAt: NOW },
    counters: { tasks: 1, approvals: 1, mail: 0, alerts: 0 },
    quickCommands: [
      { id: "qc_task", label: "Neue Aufgabe", icon: "plus", commandText: null, targetRoute: "/tasks?new=1", enabled: true, requiredCapability: "tasks.create", requiresConfirmation: false },
      { id: "qc_mail", label: "E-Mail prüfen", icon: "mail", commandText: "E-Mails prüfen", targetRoute: null, enabled: true, requiredCapability: "mail.send", requiresConfirmation: true },
    ],
    degradedSections: [],
    lastUpdatedAt: NOW,
    ...partial,
  };
}

export const overviewResponse = (data: Overview): OverviewResponse => ({
  contractVersion: "2.0.0",
  data,
  freshness: { state: "fresh", asOf: NOW },
});
