import type {
  ActivityEventListResponse,
  Agent,
  Approval,
  ApprovalListResponse,
  FridayEvent,
  Notification,
  OrbSnapshotResponse,
  OverviewResponse,
  TaskListResponse,
  TaskResponse,
} from "@friday/sdk";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAgent, makeOverview, makeTask, overviewResponse } from "@/test/fixtures";
import { queryKeys } from "../api/queryKeys";
import { applyActivityBackfill, applyEvent, cancelScheduledRefresh } from "./applyEvent";

const NOW = "2026-10-14T08:15:00Z";
const freshness = { state: "fresh", asOf: NOW } as const;
const listEnvelope = <T,>(items: T[]) => ({
  contractVersion: "2.0.0",
  items,
  pageInfo: { nextCursor: null, hasNextPage: false },
  freshness,
  sources: [],
});

function envelope(type: FridayEvent["type"], data: unknown, sequence = 1): FridayEvent {
  return {
    specversion: "1.0",
    id: `evt_${sequence}`,
    type,
    source: "adapter://mock",
    subject: "x/y",
    time: NOW,
    sequence,
    correlationId: "corr_x",
    contractVersion: "2.0.0",
    data,
  } as unknown as FridayEvent;
}

let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cancelScheduledRefresh(client);
  vi.useRealTimers();
  client.clear();
});

const tasks = (): TaskListResponse => client.getQueryData(queryKeys.tasks.list({})) as TaskListResponse;
const overviewData = () => (client.getQueryData(queryKeys.overview) as OverviewResponse).data;

describe("applyEvent: tasks", () => {
  it("patches a task in list and detail caches when the version is newer", () => {
    const task = makeTask({ version: 1, title: "Alt" });
    client.setQueryData(queryKeys.tasks.list({}), listEnvelope([task]));
    client.setQueryData<TaskResponse>(queryKeys.tasks.detail(task.id), { contractVersion: "2.0.0", data: task, freshness });
    applyEvent(client, envelope("friday.task.updated", { ...task, version: 2, title: "Neu" }));
    expect(tasks().items[0]?.title).toBe("Neu");
    expect((client.getQueryData(queryKeys.tasks.detail(task.id)) as TaskResponse).data.title).toBe("Neu");
  });

  it("ignores stale versions and is idempotent for repeated events", () => {
    const task = makeTask({ version: 5, title: "Aktuell" });
    client.setQueryData(queryKeys.tasks.list({}), listEnvelope([task]));
    applyEvent(client, envelope("friday.task.updated", { ...task, version: 4, title: "Veraltet" }));
    expect(tasks().items[0]?.title).toBe("Aktuell");
    const event = envelope("friday.task.updated", { ...task, version: 6, title: "Neu" });
    applyEvent(client, event);
    applyEvent(client, event);
    expect(tasks().items).toHaveLength(1);
    expect(tasks().items[0]?.version).toBe(6);
  });

  it("prepends created tasks to unfiltered lists only and refetches filtered ones", () => {
    const existing = makeTask({ id: "task_01JBBBBBBBBBBBBBBBBBBBBBBB" });
    client.setQueryData(queryKeys.tasks.list({}), listEnvelope([existing]));
    client.setQueryData(queryKeys.tasks.list({ status: ["done"] }), listEnvelope([]));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const created = makeTask({ id: "task_01JCCCCCCCCCCCCCCCCCCCCCCC", title: "Neu angelegt" });
    applyEvent(client, envelope("friday.task.created", created));
    expect(tasks().items.map((t) => t.title)).toEqual(["Neu angelegt", existing.title]);
    expect((client.getQueryData(queryKeys.tasks.list({ status: ["done"] })) as TaskListResponse).items).toHaveLength(0);
    expect(invalidate).toHaveBeenCalled();
  });

  it("keeps the running-task list of the overview in sync", () => {
    const running = makeTask({ status: "running" });
    client.setQueryData<OverviewResponse>(queryKeys.overview, overviewResponse(makeOverview({ runningTasks: [running] })));
    applyEvent(client, envelope("friday.task.completed", { ...running, version: 2, status: "done" }));
    expect(overviewData().runningTasks).toHaveLength(0);
  });

  it("applies task progress without touching other fields", () => {
    const task = makeTask({ progress: { mode: "determinate", value: 0.1 } });
    client.setQueryData(queryKeys.tasks.list({}), listEnvelope([task]));
    applyEvent(client, envelope("friday.task.progress", { taskId: task.id, progress: { mode: "determinate", value: 0.7 } }));
    expect(tasks().items[0]?.progress.value).toBe(0.7);
    expect(tasks().items[0]?.title).toBe(task.title);
  });
});

describe("applyEvent: activity, orb, approvals, notifications", () => {
  it("prepends activity events once", () => {
    client.setQueryData(queryKeys.activity.list({}), listEnvelope([]));
    const activity = { id: "act_01JAAAAAAAAAAAAAAAAAAAAAAA", version: 1, sequence: 3, title: "Tool gestartet" };
    applyEvent(client, envelope("friday.activity.appended", activity));
    applyEvent(client, envelope("friday.activity.appended", activity));
    const list = client.getQueryData(queryKeys.activity.list({})) as ActivityEventListResponse;
    expect(list.items).toHaveLength(1);
  });

  it("merges a backfill after a gap: ascending input, newest first, no duplicates", () => {
    client.setQueryData(queryKeys.activity.list({}), listEnvelope([{ id: "act_1", version: 1, sequence: 1 }]));
    applyActivityBackfill(client, [
      { id: "act_3", sequence: 3 },
      { id: "act_2", sequence: 2 },
      { id: "act_1", sequence: 1 },
    ] as never);
    const ids = (client.getQueryData(queryKeys.activity.list({})) as ActivityEventListResponse).items.map((e) => e.id);
    expect(ids).toEqual(["act_3", "act_2", "act_1"]);
  });

  it("sets the orb snapshot in the cache and in the overview", () => {
    client.setQueryData<OverviewResponse>(queryKeys.overview, overviewResponse(makeOverview()));
    const snapshot = {
      status: { mode: "working", since: NOW, progress: 0.6 },
      layers: { voice: "idle", work: "working", attention: "none", health: "online", activeAgentIds: [] },
    };
    applyEvent(client, envelope("friday.orb.status_changed", snapshot));
    expect((client.getQueryData(queryKeys.orb) as OrbSnapshotResponse).data.status.mode).toBe("working");
    expect(overviewData().orb.status.mode).toBe("working");
  });

  it("counts a new pending approval once and removes it when resolved", () => {
    client.setQueryData<OverviewResponse>(queryKeys.overview, overviewResponse(makeOverview({ counters: { tasks: 0, approvals: 0, mail: 0, alerts: 0 } })));
    client.setQueryData(queryKeys.approvals.list({}), listEnvelope([]));
    const approval = { id: "appr_01JAAAAAAAAAAAAAAAAAAAAAAA", version: 1, status: "pending", action: "E-Mail senden" } as unknown as Approval;
    applyEvent(client, envelope("friday.approval.requested", approval));
    applyEvent(client, envelope("friday.approval.requested", approval));
    expect(overviewData().counters.approvals).toBe(1);
    expect(overviewData().openApprovals).toHaveLength(1);
    applyEvent(client, envelope("friday.approval.resolved", { ...approval, version: 2, status: "approved" }));
    expect(overviewData().counters.approvals).toBe(0);
    expect(overviewData().openApprovals).toHaveLength(0);
    expect((client.getQueryData(queryKeys.approvals.list({})) as ApprovalListResponse).items[0]?.status).toBe("approved");
  });

  it("tracks critical alerts in the overview counters", () => {
    client.setQueryData<OverviewResponse>(queryKeys.overview, overviewResponse(makeOverview()));
    const alert = { id: "ntf_01JAAAAAAAAAAAAAAAAAAAAAAA", version: 1, priority: "P0", status: "open", title: "Adapter down" } as unknown as Notification;
    applyEvent(client, envelope("friday.notification.created", alert));
    expect(overviewData().counters.alerts).toBe(1);
    applyEvent(client, envelope("friday.notification.updated", { ...alert, version: 2, status: "resolved" }));
    expect(overviewData().counters.alerts).toBe(0);
  });
});

describe("applyEvent: agents, system, resync", () => {
  it("patches heartbeats into agent lists and the overview", () => {
    const agent: Agent = makeAgent({ status: "idle" });
    client.setQueryData(queryKeys.agents.list({}), listEnvelope([agent]));
    client.setQueryData<OverviewResponse>(queryKeys.overview, overviewResponse(makeOverview({ activeAgents: [agent] })));
    applyEvent(client, envelope("friday.agent.heartbeat", { agentId: agent.id, heartbeatAt: NOW, status: "working", currentTaskId: "task_01JAAAAAAAAAAAAAAAAAAAAAAA" }));
    expect(overviewData().activeAgents[0]?.status).toBe("working");
  });

  it("writes system metrics into the overview summary", () => {
    client.setQueryData<OverviewResponse>(queryKeys.overview, overviewResponse(makeOverview()));
    applyEvent(
      client,
      envelope("friday.system.metrics", {
        sampledAt: NOW,
        cpu: { usagePercent: 77, cores: 8 },
        ram: { usedBytes: 1, totalBytes: 2, usagePercent: 50 },
        gpu: null,
        vram: null,
        storage: [{ usagePercent: 61 }],
        network: { rxBytesPerSec: 0, txBytesPerSec: 0 },
      }),
    );
    expect(overviewData().systemSummary).toMatchObject({ cpuPercent: 77, ramPercent: 50, gpuPercent: null, storageUsedPercent: 61 });
  });

  it("invalidates adapter-related caches on health changes", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    applyEvent(client, envelope("friday.adapter.health_changed", { adapterId: "mock-mail", status: "offline" }));
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(queryKeys.health));
    expect(keys).toContain(JSON.stringify(queryKeys.capabilities));
  });

  it("refetches all snapshots on resync_required", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    applyEvent(client, envelope("friday.status.resync_required", { reason: "unknown", requestedSince: 1, oldestAvailableSequence: null, latestSequence: 9 }));
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(queryKeys.overview));
    expect(keys).toContain(JSON.stringify(queryKeys.tasks.all));
    expect(keys).toContain(JSON.stringify(queryKeys.orb));
    // Module data too: after a profile switch (empty installation) a stale memory graph would contradict the counters.
    expect(keys).toContain(JSON.stringify(queryKeys.memory.all));
    expect(keys).toContain(JSON.stringify(queryKeys.calendar.events.all));
    expect(keys).toContain(JSON.stringify(queryKeys.communication.channels));
  });

  it("debounces the derived overview refresh into one refetch per burst", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const overviewCalls = () => invalidate.mock.calls.filter((call) => JSON.stringify(call[0]?.queryKey) === JSON.stringify(queryKeys.overview)).length;
    for (let i = 0; i < 5; i += 1) applyEvent(client, envelope("friday.task.created", makeTask({ id: `task_0${i}AAAAAAAAAAAAAAAAAAAAAAAA` })));
    expect(overviewCalls()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(overviewCalls()).toBe(1);
  });
});

describe("applyEvent: files (group C)", () => {
  const FILE_ID = "file_01JAAAAAAAAAAAAAAAAAAAAAAA";
  const file = (version: number) => ({ id: FILE_ID, version, name: "Bericht.md" });

  it("drops the cached preview when a file gets a new version", () => {
    client.setQueryData(queryKeys.files.preview(FILE_ID), { data: { text: "alt" } });
    applyEvent(client, envelope("friday.file.updated", file(2)));
    expect(client.getQueryState(queryKeys.files.preview(FILE_ID))?.isInvalidated).toBe(true);
  });

  it("removes the cached preview when the file is deleted", () => {
    client.setQueryData(queryKeys.files.preview(FILE_ID), { data: { text: "alt" } });
    applyEvent(client, envelope("friday.file.deleted", { id: FILE_ID }));
    expect(client.getQueryData(queryKeys.files.preview(FILE_ID))).toBeUndefined();
  });
});
