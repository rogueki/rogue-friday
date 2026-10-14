import { CONTRACT_VERSION, type Agent, type Approval, type Task } from "@jarvis/sdk";
import { defaultCapabilities } from "../core/constants";
import type { IdFactory } from "../core/ids";
import { Rng } from "../core/prng";
import type { ProfileName, WorldState } from "../world/state";
import { buildActivity } from "./activity";
import { buildAgents, buildBulkAgents } from "./agents";
import { buildBulkApprovals, buildCuratedApprovals } from "./approvals";
import { buildAudit } from "./audit";
import { buildAutomations, buildBulkAutomations } from "./automations";
import { buildCuratedCalendar, buildFillerEvents } from "./calendar";
import { buildBulkThreads, buildChannels, buildCuratedCommunication } from "./communication";
import { createSeedContext, type SeedContext, type SeedSizes } from "./context";
import { buildBulkFiles, buildFiles } from "./files";
import { applyLongGerman } from "./long-german";
import { buildAdapters, buildCommandHistory, buildQuickCommands } from "./meta";
import { buildBulkMemory, buildCuratedMemory } from "./memory";
import { buildBulkNotifications, buildNotifications } from "./notifications";
import { buildResearch } from "./research";
import { buildLayouts, buildSettings, buildThemes } from "./settings";
import { createStory } from "./story";
import { buildSystem } from "./system";
import { buildBulkTasks, buildCuratedTasks } from "./tasks";
import { buildVoice } from "./voice";

const SIZES: Record<ProfileName, SeedSizes> = {
  default: { tasks: 28, activity: 160, agents: 8, memory: 40, threads: 14, files: 22, notifications: 10, audit: 80 },
  longGerman: { tasks: 28, activity: 160, agents: 8, memory: 40, threads: 14, files: 22, notifications: 10, audit: 80 },
  empty: { tasks: 0, activity: 0, agents: 0, memory: 0, threads: 0, files: 0, notifications: 0, audit: 0 },
  highLoad: { tasks: 1000, activity: 10_000, agents: 100, memory: 300, threads: 120, files: 200, notifications: 60, audit: 500 },
};

export function sizesFor(profile: ProfileName): SeedSizes {
  return SIZES[profile];
}

/** Epoch used for the id timestamp component; fixed so ids do not depend on the (changeable) clock. */
export const ID_EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");

export function createContextFor(seed: number, ids: IdFactory, nowMs: number, profile: ProfileName): SeedContext {
  return createSeedContext(seed, new Rng(seed ^ 0x5eed), ids, nowMs, SIZES[profile]);
}

/** Builds the complete initial state of a profile from the seeded generators. */
export function buildWorldState(ctx: SeedContext, profile: ProfileName): WorldState {
  const story = createStory(ctx);
  const empty = profile === "empty";
  const sizes = ctx.sizes;
  const settings = buildSettings(ctx);
  const system = buildSystem(ctx);
  const voice = buildVoice(ctx);

  const state: Partial<WorldState> = {};

  if (!empty) {
    const agents: Agent[] = buildAgents(ctx, story);
    if (sizes.agents > agents.length) agents.push(...buildBulkAgents(ctx, sizes.agents - agents.length, agents.length));
    const agentNames = Object.fromEntries(agents.map((agent) => [agent.id, agent.name]));
    const tasks: Task[] = buildCuratedTasks(ctx, story, agentNames);
    const bulkAgentList = agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      tools: agent.capabilities.length ? ["fs.read", "web.fetch", "mail.read"] : ["fs.read"],
    }));
    if (sizes.tasks > tasks.length) {
      tasks.push(
        ...buildBulkTasks(ctx, {
          count: sizes.tasks - tasks.length,
          cycleStatuses: profile !== "highLoad",
          agents: bulkAgentList,
          startIndex: tasks.length,
        }),
      );
    }
    reconcileAgentsAndTasks(agents, tasks);

    const approvals: Approval[] = [
      ...buildCuratedApprovals(ctx, story),
      ...buildBulkApprovals(
        ctx,
        profile === "highLoad" ? 40 : 2,
        agents.map((agent) => agent.id),
        tasks.map((task) => task.id),
        profile === "highLoad" ? [] : ["cancelled", "approved"],
      ),
    ];
    const fileSeed = buildFiles(ctx, story, agentNames);
    const bulkFileCount = Math.max(0, sizes.files - fileSeed.files.length);
    const bulkFiles = buildBulkFiles(ctx, story, bulkFileCount, agents.map((agent) => agent.id));
    const comm = buildCuratedCommunication(ctx, story);
    const bulkComm = buildBulkThreads(ctx, story, Math.max(0, sizes.threads - comm.threads.length), comm.threads.length);
    const calendar = buildCuratedCalendar(ctx, story);
    const automations = buildAutomations(ctx, story);
    const bulkAutomations = profile === "highLoad" ? buildBulkAutomations(ctx, 14) : { automations: [], runs: [] };
    const research = buildResearch(ctx, story);
    const memory = [...buildCuratedMemory(ctx, story, agentNames)];
    if (sizes.memory > memory.length) memory.push(...buildBulkMemory(ctx, story, sizes.memory - memory.length));
    const notifications = buildNotifications(ctx, story);
    if (sizes.notifications > notifications.length) {
      notifications.push(...buildBulkNotifications(ctx, sizes.notifications - notifications.length));
    }
    const activity = buildActivity(ctx, {
      tasks,
      agents,
      target: sizes.activity,
      extraToolCallsPerTask: profile === "highLoad" ? 8 : 0,
    });
    const audit = buildAudit(ctx, { tasks, agents, approvals, target: sizes.audit });

    Object.assign(state, {
      tasks,
      activity,
      memory,
      agents,
      approvals,
      channels: buildChannels(ctx, story),
      threads: [...comm.threads, ...bulkComm.threads],
      messages: [...comm.messages, ...bulkComm.messages],
      drafts: comm.drafts,
      calendarEvents: [...calendar.events, ...buildFillerEvents(ctx, profile === "highLoad" ? 60 : 6)],
      calendarConflicts: calendar.conflicts,
      calendarBriefings: calendar.briefings,
      calendarProposals: calendar.proposals,
      automations: [...automations.automations, ...bulkAutomations.automations],
      automationRuns: [...automations.runs, ...bulkAutomations.runs],
      researchProjects: research.projects,
      researchSources: research.sources,
      researchFindings: research.findings,
      researchArtifacts: research.artifacts,
      files: [...fileSeed.files, ...bulkFiles.files],
      fileContents: { ...fileSeed.contents, ...bulkFiles.contents },
      notifications,
      audit: audit.events,
      auditSequence: audit.sequence,
      sequence: activity.length,
      commandHistory: buildCommandHistory(ctx),
    });
  } else {
    const emptyChannels = buildChannels(ctx, story).map(({ address: _address, ...channel }) => ({
      ...channel,
      status: "not_configured" as const,
      capabilities: { read: false, draft: false, send: false },
      unreadCount: 0,
      lastSyncAt: null,
    }));
    Object.assign(state, {
      tasks: [],
      activity: [],
      memory: [],
      agents: [],
      approvals: [],
      channels: emptyChannels,
      threads: [],
      messages: [],
      drafts: [],
      calendarEvents: [],
      calendarConflicts: [],
      calendarBriefings: [],
      calendarProposals: [],
      automations: [],
      automationRuns: [],
      researchProjects: [],
      researchSources: [],
      researchFindings: [],
      researchArtifacts: [],
      files: [],
      fileContents: {},
      notifications: [],
      audit: [],
      auditSequence: 0,
      sequence: 0,
      commandHistory: [],
    });
    voice.profiles = [];
    voice.status.speakerVerification = { enabled: false, state: "disabled", recognizedSpeaker: null, confidence: null };
    voice.status.trustedSession = { active: false, expiresAt: null };
    voice.metrics = {
      ...voice.metrics,
      wakeWordLatency: { currentMs: null, avgMs: null, p95Ms: null, sampleCount: 0 },
      speakerVerificationLatency: { currentMs: null, avgMs: null, p95Ms: null, sampleCount: 0 },
      sttLatency: { currentMs: null, avgMs: null, p95Ms: null, sampleCount: 0 },
      routerLatency: { currentMs: null, avgMs: null, p95Ms: null, sampleCount: 0 },
      firstToken: { currentMs: null, avgMs: null, p95Ms: null, sampleCount: 0 },
      ttsFirstAudio: { currentMs: null, avgMs: null, p95Ms: null, sampleCount: 0 },
    };
    for (const service of system.services) {
      if (service.status !== "online") {
        service.status = "online";
        service.latencyMs = 40;
        service.detail = "Dienst läuft";
        service.lastSuccessAt = service.lastCheckAt;
      }
    }
  }

  const sessionSuffix = ctx.id("csrf");
  const full: WorldState = {
    ...(state as Required<Pick<WorldState,
      | "tasks" | "activity" | "memory" | "agents" | "approvals" | "channels" | "threads" | "messages" | "drafts"
      | "calendarEvents" | "calendarConflicts" | "calendarBriefings" | "calendarProposals" | "automations"
      | "automationRuns" | "researchProjects" | "researchSources" | "researchFindings" | "researchArtifacts"
      | "files" | "fileContents" | "notifications" | "audit" | "auditSequence" | "sequence" | "commandHistory">>),
    voice,
    system,
    settings,
    themes: buildThemes(),
    layouts: buildLayouts(),
    commandPreviews: {},
    quickCommands: buildQuickCommands(),
    capabilities: defaultCapabilities(CONTRACT_VERSION),
    adapters: buildAdapters(ctx),
    sync: [],
    orb: { mode: "idle", since: ctx.at(0), signature: "" },
    forcedOrb: null,
    transientOrb: null,
    globalPaused: false,
    idempotency: {},
    reauthTokens: [],
    session: {
      authenticated: true,
      userId: ctx.owner.id,
      displayName: "Erik Brandt",
      role: "owner",
      csrfToken: sessionSuffix,
      expiresAt: ctx.at(8 * 3_600_000),
      reauthUntil: null,
    },
    startedAt: ctx.at(-(26 * 3_600_000 + 12 * 60_000)),
    control: { latencyMs: 0, errorRate: 0 },
    uiHints: { forceOrbFallback2D: false, reducedMotion: false },
    audioLevel: 0,
    eventStreamState: "online",
  };
  if (profile === "longGerman") applyLongGerman(full, new Rng(ctx.seed ^ 0x10e6));
  return full;
}

/**
 * Keeps agent and task data consistent: an agent is `working` exactly when it owns a running task, and its
 * `currentTaskId` points at that task.
 */
function reconcileAgentsAndTasks(agents: Agent[], tasks: Task[]): void {
  const runningByAgent = new Map<string, Task>();
  for (const task of tasks) {
    if (task.status === "running" && task.agentId && !runningByAgent.has(task.agentId)) runningByAgent.set(task.agentId, task);
  }
  for (const agent of agents) {
    if (agent.currentTaskId) continue;
    const task = runningByAgent.get(agent.id);
    if (task) {
      agent.currentTaskId = task.id;
      if (agent.status === "idle" || agent.status === "starting") agent.status = "working";
      if (agent.status === "working" && !agent.startedAt) {
        agent.startedAt = task.startedAt;
        agent.runtimeMs = task.runtimeMs;
        agent.activeTools = agent.capabilities.length ? ["fs.read"] : [];
      }
    } else if (agent.status === "working" || agent.status === "waiting") {
      agent.status = "idle";
      agent.activeTools = [];
      agent.startedAt = null;
      agent.runtimeMs = null;
    }
  }
}
