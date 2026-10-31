import type {
  ActivityEvent,
  Capabilities,
  FridayEvent,
  Notification,
  OrbSnapshotResponse,
  Overview,
  OverviewResponse,
  SettingsResponse,
  Task,
} from "@friday/sdk";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { queryKeys, SNAPSHOT_ROOT_KEYS } from "../api/queryKeys";
import { playDashboardSound, type DashboardSoundKind } from "../soundEffects";

/**
 * Event -> TanStack Query cache reducer (PLAN §12, §48.6). Deterministic: the same event applied to the same cache
 * always yields the same cache, resources are only replaced by an equal or newer `version`, and filtered lists are
 * patched in place and then refetched instead of guessing their membership.
 */

interface Identified {
  id: string;
  version?: number | string;
}
interface ListCache<T> {
  items: T[];
  pageInfo?: unknown;
  [key: string]: unknown;
}
interface DetailCache<T> {
  data: T;
  [key: string]: unknown;
}

const ACTIVITY_LIST_CAP = 200;
const OVERVIEW_REFRESH_DELAY_MS = 1500;

const overviewTimers = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>();
const soundedEvents = new WeakMap<QueryClient, Set<string>>();

function playConfiguredSound(queryClient: QueryClient, eventId: string, kind: DashboardSoundKind): void {
  const enabled = queryClient.getQueryData<SettingsResponse>(queryKeys.settings.root)?.data.dashboard.soundEffects === true;
  if (!enabled) return;
  let ids = soundedEvents.get(queryClient);
  if (!ids) { ids = new Set(); soundedEvents.set(queryClient, ids); }
  if (ids.has(eventId)) return;
  ids.add(eventId);
  if (ids.size > 512) ids.delete(ids.values().next().value as string);
  playDashboardSound(true, kind);
}

/** Coalesces derived overview sections (attention, counters) into one refetch after a burst of events. */
function scheduleOverviewRefresh(queryClient: QueryClient): void {
  if (overviewTimers.has(queryClient)) return;
  overviewTimers.set(
    queryClient,
    setTimeout(() => {
      overviewTimers.delete(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview, refetchType: "active" });
    }, OVERVIEW_REFRESH_DELAY_MS),
  );
}

export function cancelScheduledRefresh(queryClient: QueryClient): void {
  const timer = overviewTimers.get(queryClient);
  if (timer !== undefined) clearTimeout(timer);
  overviewTimers.delete(queryClient);
}

const isNewerOrEqual = (next: Identified, previous: Identified): boolean =>
  typeof next.version === "number" && typeof previous.version === "number" ? next.version >= previous.version : true;

/** Lists that only differ by paging/sorting still show "everything"; any other filter makes membership unknowable. */
function isUnfilteredFirstPage(filters: unknown): boolean {
  if (!filters || typeof filters !== "object") return true;
  return Object.entries(filters).every(([key, value]) => {
    if (value === undefined || value === null || value === "") return true;
    return key === "limit" || key === "sort";
  });
}

function listEntries<T>(queryClient: QueryClient, listsKey: QueryKey): [QueryKey, ListCache<T>][] {
  return queryClient
    .getQueriesData<ListCache<T>>({ queryKey: listsKey })
    .filter((entry): entry is [QueryKey, ListCache<T>] => Array.isArray(entry[1]?.items));
}

interface UpsertOptions {
  /** Prepend into unfiltered first-page lists when the item is not yet part of them (created events). */
  insert?: boolean;
  /** Refetch active filtered lists (membership may have changed). */
  refetchFiltered?: boolean;
  cap?: number;
}

function upsertResource<T extends Identified>(
  queryClient: QueryClient,
  keys: { lists: QueryKey; detail: (id: string) => QueryKey },
  item: T,
  options: UpsertOptions = {},
): void {
  let touchedFiltered = false;
  for (const [key, cache] of listEntries<T>(queryClient, keys.lists)) {
    const unfiltered = isUnfilteredFirstPage(key[2]);
    const index = cache.items.findIndex((existing) => existing.id === item.id);
    if (index >= 0) {
      const existing = cache.items[index] as T;
      if (!isNewerOrEqual(item, existing)) continue;
      const items = cache.items.slice();
      items[index] = item;
      queryClient.setQueryData(key, { ...cache, items });
    } else if (options.insert && unfiltered) {
      const items = [item, ...cache.items];
      queryClient.setQueryData(key, { ...cache, items: options.cap ? items.slice(0, options.cap) : items });
    }
    if (!unfiltered) touchedFiltered = true;
  }
  const detailKey = keys.detail(item.id);
  const detail = queryClient.getQueryData<DetailCache<T>>(detailKey);
  if (detail && isNewerOrEqual(item, detail.data)) queryClient.setQueryData(detailKey, { ...detail, data: { ...detail.data, ...item } });
  if (options.refetchFiltered || touchedFiltered) {
    void queryClient.invalidateQueries({
      queryKey: keys.lists,
      predicate: (query) => !isUnfilteredFirstPage(query.queryKey[2]),
      refetchType: "active",
    });
  }
}

function removeResource(queryClient: QueryClient, keys: { lists: QueryKey; detail: (id: string) => QueryKey }, id: string): void {
  for (const [key, cache] of listEntries<Identified>(queryClient, keys.lists)) {
    if (cache.items.some((existing) => existing.id === id)) {
      queryClient.setQueryData(key, { ...cache, items: cache.items.filter((existing) => existing.id !== id) });
    }
  }
  queryClient.removeQueries({ queryKey: keys.detail(id) });
}

const taskKeys = { lists: queryKeys.tasks.lists(), detail: queryKeys.tasks.detail };
const agentKeys = { lists: queryKeys.agents.lists(), detail: queryKeys.agents.detail };
const approvalKeys = { lists: queryKeys.approvals.lists(), detail: queryKeys.approvals.detail };
const activityKeys = { lists: queryKeys.activity.lists(), detail: queryKeys.activity.detail };
const memoryKeys = { lists: queryKeys.memory.lists(), detail: queryKeys.memory.detail };
const fileKeys = { lists: queryKeys.files.lists(), detail: queryKeys.files.detail };
const automationKeys = { lists: queryKeys.automations.lists(), detail: queryKeys.automations.detail };
const eventKeys = { lists: queryKeys.calendar.events.lists(), detail: queryKeys.calendar.events.detail };
const threadKeys = { lists: queryKeys.communication.threads.lists(), detail: queryKeys.communication.threads.detail };
const draftKeys = { lists: queryKeys.communication.drafts.lists(), detail: queryKeys.communication.drafts.detail };
const auditKeys = { lists: queryKeys.audit.lists(), detail: queryKeys.audit.detail };
const notificationKeys = { lists: queryKeys.notifications.lists(), detail: queryKeys.notifications.detail };

function patchOverview(queryClient: QueryClient, patch: (overview: Overview) => Overview): void {
  queryClient.setQueryData<OverviewResponse>(queryKeys.overview, (old) => (old ? { ...old, data: patch(old.data) } : old));
}

function setEnvelopeData<T>(queryClient: QueryClient, key: QueryKey, data: T): void {
  queryClient.setQueryData<DetailCache<T>>(key, (old) => (old ? { ...old, data } : old));
}

function replaceById<T extends Identified>(items: T[], item: T): T[] {
  return items.map((existing) => (existing.id === item.id && isNewerOrEqual(item, existing) ? item : existing));
}

function syncRunningTasks(overview: Overview, task: Task): Overview {
  const running = overview.runningTasks;
  const present = running.some((t) => t.id === task.id);
  if (task.status === "running") {
    return { ...overview, runningTasks: present ? replaceById(running, task) : [task, ...running] };
  }
  return present ? { ...overview, runningTasks: running.filter((t) => t.id !== task.id) } : overview;
}

function invalidateSnapshots(queryClient: QueryClient): void {
  for (const key of SNAPSHOT_ROOT_KEYS) void queryClient.invalidateQueries({ queryKey: key });
}

function isCriticalAlert(notification: Notification): boolean {
  return (notification.priority === "P0" || notification.priority === "P1") && notification.status === "open";
}

export function applyEvent(queryClient: QueryClient, event: FridayEvent): void {
  switch (event.type) {
    // ── status / orb / voice ────────────────────────────────────────────
    case "friday.status.changed": {
      setEnvelopeData(queryClient, queryKeys.status, event.data);
      patchOverview(queryClient, (o) => ({ ...o, friday: event.data }));
      return;
    }
    case "friday.status.resync_required": {
      invalidateSnapshots(queryClient);
      return;
    }
    case "friday.orb.status_changed": {
      queryClient.setQueryData<OrbSnapshotResponse>(queryKeys.orb, (old) =>
        old
          ? { ...old, data: event.data, freshness: { state: "fresh", asOf: event.time } }
          : { contractVersion: event.contractVersion, data: event.data, freshness: { state: "fresh", asOf: event.time } },
      );
      patchOverview(queryClient, (o) => ({ ...o, orb: event.data }));
      return;
    }
    case "friday.voice.state_changed": {
      setEnvelopeData(queryClient, queryKeys.voice.status, event.data);
      patchOverview(queryClient, (o) => ({ ...o, voice: event.data }));
      return;
    }
    case "friday.voice.audio_level":
    case "friday.voice.transcript_partial":
    case "friday.voice.transcript_final":
    case "friday.voice.tts_started":
    case "friday.voice.tts_ended":
    case "friday.ui.navigation_requested":
      // High-frequency / ephemeral: consumed by the orb audio store, the voice feature and the dashboard tour, never cached.
      return;

    // ── tasks ───────────────────────────────────────────────────────────
    case "friday.task.created":
    case "friday.task.updated":
    case "friday.task.completed":
    case "friday.task.failed":
    case "friday.task.cancelled": {
      const task = event.data;
      upsertResource(queryClient, taskKeys, task, { insert: event.type === "friday.task.created", refetchFiltered: event.type !== "friday.task.updated" });
      patchOverview(queryClient, (o) => syncRunningTasks(o, task));
      scheduleOverviewRefresh(queryClient);
      return;
    }
    case "friday.task.progress": {
      const { taskId, progress } = event.data;
      for (const [key, cache] of listEntries<Task>(queryClient, taskKeys.lists)) {
        if (cache.items.some((t) => t.id === taskId)) {
          queryClient.setQueryData(key, { ...cache, items: cache.items.map((t) => (t.id === taskId ? { ...t, progress } : t)) });
        }
      }
      queryClient.setQueryData<DetailCache<Task>>(queryKeys.tasks.detail(taskId), (old) => (old ? { ...old, data: { ...old.data, progress } } : old));
      patchOverview(queryClient, (o) => ({ ...o, runningTasks: o.runningTasks.map((t) => (t.id === taskId ? { ...t, progress } : t)) }));
      return;
    }

    // ── activity / audit ────────────────────────────────────────────────
    case "friday.activity.appended": {
      upsertResource(queryClient, activityKeys, event.data, { insert: true, cap: ACTIVITY_LIST_CAP });
      return;
    }
    case "friday.audit.appended": {
      upsertResource(queryClient, auditKeys, event.data, { insert: true, cap: ACTIVITY_LIST_CAP });
      return;
    }

    // ── agents ──────────────────────────────────────────────────────────
    case "friday.agent.status_changed": {
      const agent = event.data;
      upsertResource(queryClient, agentKeys, agent, {});
      patchOverview(queryClient, (o) => {
        const present = o.activeAgents.some((a) => a.id === agent.id);
        if (present) return { ...o, activeAgents: replaceById(o.activeAgents, agent) };
        return agent.status === "working" || agent.status === "starting" ? { ...o, activeAgents: [...o.activeAgents, agent] } : o;
      });
      return;
    }
    case "friday.agent.heartbeat": {
      const { agentId, heartbeatAt, status, currentTaskId } = event.data;
      const patch = { heartbeatAt, status, currentTaskId };
      for (const [key, cache] of listEntries<{ id: string }>(queryClient, agentKeys.lists)) {
        if (cache.items.some((a) => a.id === agentId)) {
          queryClient.setQueryData(key, { ...cache, items: cache.items.map((a) => (a.id === agentId ? { ...a, ...patch } : a)) });
        }
      }
      queryClient.setQueryData<DetailCache<object>>(queryKeys.agents.detail(agentId), (old) => (old ? { ...old, data: { ...old.data, ...patch } } : old));
      patchOverview(queryClient, (o) => ({ ...o, activeAgents: o.activeAgents.map((a) => (a.id === agentId ? { ...a, ...patch } : a)) }));
      return;
    }

    // ── approvals ───────────────────────────────────────────────────────
    case "friday.approval.requested":
    case "friday.approval.resolved":
    case "friday.approval.expired": {
      const approval = event.data;
      if (event.type === "friday.approval.requested") playConfiguredSound(queryClient, event.id, "approval");
      upsertResource(queryClient, approvalKeys, approval, { insert: event.type === "friday.approval.requested", refetchFiltered: true });
      patchOverview(queryClient, (o) => {
        const present = o.openApprovals.some((a) => a.id === approval.id);
        if (approval.status === "pending") {
          return present
            ? { ...o, openApprovals: replaceById(o.openApprovals, approval) }
            : { ...o, openApprovals: [approval, ...o.openApprovals], counters: { ...o.counters, approvals: o.counters.approvals + 1 } };
        }
        return present
          ? { ...o, openApprovals: o.openApprovals.filter((a) => a.id !== approval.id), counters: { ...o.counters, approvals: Math.max(0, o.counters.approvals - 1) } }
          : o;
      });
      scheduleOverviewRefresh(queryClient);
      return;
    }

    // ── notifications ───────────────────────────────────────────────────
    case "friday.notification.created":
    case "friday.notification.updated": {
      const notification = event.data;
      if (event.type === "friday.notification.created" && notification.status === "open") playConfiguredSound(queryClient, event.id, "alert");
      upsertResource(queryClient, notificationKeys, notification, { insert: event.type === "friday.notification.created", refetchFiltered: true });
      patchOverview(queryClient, (o) => {
        const present = o.criticalAlerts.some((n) => n.id === notification.id);
        if (isCriticalAlert(notification)) {
          return present
            ? { ...o, criticalAlerts: replaceById(o.criticalAlerts, notification) }
            : { ...o, criticalAlerts: [notification, ...o.criticalAlerts], counters: { ...o.counters, alerts: o.counters.alerts + 1 } };
        }
        return present
          ? { ...o, criticalAlerts: o.criticalAlerts.filter((n) => n.id !== notification.id), counters: { ...o.counters, alerts: Math.max(0, o.counters.alerts - 1) } }
          : o;
      });
      scheduleOverviewRefresh(queryClient);
      return;
    }

    // ── system / adapters ───────────────────────────────────────────────
    case "friday.system.metrics": {
      const metrics = event.data;
      setEnvelopeData(queryClient, queryKeys.system.metrics, metrics);
      patchOverview(queryClient, (o) => ({
        ...o,
        systemSummary: {
          ...o.systemSummary,
          cpuPercent: metrics.cpu.usagePercent,
          ramPercent: metrics.ram.usagePercent,
          gpuPercent: metrics.gpu?.usagePercent ?? null,
          vramPercent: metrics.vram?.usagePercent ?? null,
          storageUsedPercent: metrics.storage[0]?.usagePercent ?? o.systemSummary.storageUsedPercent,
        },
      }));
      return;
    }
    case "friday.system.service_status_changed": {
      const service = event.data;
      queryClient.setQueryData<ListCache<Identified>>(queryKeys.system.services, (old) =>
        old ? { ...old, items: old.items.some((s) => s.id === service.id) ? old.items.map((s) => (s.id === service.id ? service : s)) : [...old.items, service] } : old,
      );
      patchOverview(queryClient, (o) => ({
        ...o,
        systemSummary: {
          ...o.systemSummary,
          services: o.systemSummary.services.map((s) => (s.id === service.id ? { ...s, name: service.name, status: service.status } : s)),
        },
      }));
      return;
    }
    case "friday.adapter.health_changed": {
      const health = event.data;
      for (const [key, cache] of listEntries<{ manifest: { id: string }; health: unknown }>(queryClient, queryKeys.adapters.lists())) {
        queryClient.setQueryData(key, { ...cache, items: cache.items.map((a) => (a.manifest.id === health.adapterId ? { ...a, health } : a)) });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.health });
      void queryClient.invalidateQueries({ queryKey: queryKeys.capabilities });
      // The voice page reads its own status endpoint; without this it shows a recovered voice service as offline until the next poll.
      void queryClient.invalidateQueries({ queryKey: queryKeys.voice.status });
      scheduleOverviewRefresh(queryClient);
      return;
    }
    case "friday.adapter.capabilities_changed": {
      queryClient.setQueryData<Capabilities>(queryKeys.capabilities, event.data);
      scheduleOverviewRefresh(queryClient);
      return;
    }

    // ── memory ──────────────────────────────────────────────────────────
    case "friday.memory.created":
    case "friday.memory.updated": {
      upsertResource(queryClient, memoryKeys, event.data, { insert: event.type === "friday.memory.created", refetchFiltered: true });
      if (event.type === "friday.memory.created") {
        patchOverview(queryClient, (o) =>
          o.memoryInsights
            ? { ...o, memoryInsights: { total: o.memoryInsights.total + 1, newToday: o.memoryInsights.newToday + 1, lastUpdatedAt: event.time } }
            : o,
        );
      }
      return;
    }
    case "friday.memory.deleted": {
      removeResource(queryClient, memoryKeys, event.data.id);
      patchOverview(queryClient, (o) => (o.memoryInsights ? { ...o, memoryInsights: { ...o.memoryInsights, total: Math.max(0, o.memoryInsights.total - 1) } } : o));
      return;
    }

    // ── communication / calendar ────────────────────────────────────────
    case "friday.communication.thread_updated": {
      upsertResource(queryClient, threadKeys, event.data, { insert: true, refetchFiltered: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.communication.channels });
      scheduleOverviewRefresh(queryClient);
      return;
    }
    case "friday.communication.draft_updated": {
      upsertResource(queryClient, draftKeys, event.data, { insert: true });
      return;
    }
    case "friday.calendar.event_updated": {
      upsertResource(queryClient, eventKeys, event.data, { insert: true, refetchFiltered: true });
      scheduleOverviewRefresh(queryClient);
      return;
    }
    case "friday.calendar.conflict_detected": {
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendar.conflicts });
      return;
    }

    // ── automations / research / files ──────────────────────────────────
    case "friday.automation.updated": {
      upsertResource(queryClient, automationKeys, event.data, { insert: true, refetchFiltered: true });
      return;
    }
    case "friday.automation.run_started":
    case "friday.automation.run_finished": {
      void queryClient.invalidateQueries({ queryKey: ["automations", "runs"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.automations.lists() });
      return;
    }
    case "friday.research.updated":
    case "friday.research.source_added":
    case "friday.research.finding_added": {
      void queryClient.invalidateQueries({ queryKey: queryKeys.research.all, refetchType: "active" });
      return;
    }
    case "friday.file.created":
    case "friday.file.updated": {
      upsertResource(queryClient, fileKeys, event.data, { insert: event.type === "friday.file.created", refetchFiltered: true });
      // A new version changes the content: the cached preview of this file must not outlive it.
      void queryClient.invalidateQueries({ queryKey: queryKeys.files.preview(event.data.id), refetchType: "active" });
      return;
    }
    case "friday.file.deleted": {
      removeResource(queryClient, fileKeys, event.data.id);
      queryClient.removeQueries({ queryKey: queryKeys.files.preview(event.data.id) });
      return;
    }
    default: {
      // Exhaustiveness: a new event type in the contract becomes a compile error here until it is handled.
      const unhandled: never = event;
      void unhandled;
    }
  }
}

/**
 * Merges the activity tail fetched after a sequence gap. Items arrive ascending by sequence; inserting them one by one at
 * the head of the unfiltered lists leaves the newest event first, matching the live ordering.
 */
export function applyActivityBackfill(queryClient: QueryClient, items: readonly ActivityEvent[]): void {
  const ascending = items.slice().sort((a, b) => a.sequence - b.sequence);
  for (const item of ascending) {
    const known = listEntries<ActivityEvent>(queryClient, activityKeys.lists).some(([, cache]) => cache.items.some((existing) => existing.id === item.id));
    if (!known) upsertResource(queryClient, activityKeys, item, { insert: true, cap: ACTIVITY_LIST_CAP });
  }
}
