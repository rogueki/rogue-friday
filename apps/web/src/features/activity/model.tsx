import type { ActivityEvent, ActivityKind, Severity } from "@jarvis/sdk";
import type { Tone } from "@jarvis/ui";
import { Activity, Bot, Check, FileText, Globe, ListChecks, MessageSquare, Plug, Terminal, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import type { ActivityFilters } from "@/lib/api/domains/activity";

const ICON = { size: 18, strokeWidth: 1.5 } as const;

export const ACTIVITY_KINDS: readonly ActivityKind[] = ["user_request", "task", "agent", "tool_call", "source_read", "result", "artifact", "adapter", "system"];
export const SEVERITIES: readonly Severity[] = ["info", "warning", "error", "critical"];
export const ACTIVITY_STATUSES = ["started", "running", "succeeded", "failed", "cancelled", "info"] as const;

export const KIND_ICON: Record<ActivityKind, ReactNode> = {
  user_request: <MessageSquare {...ICON} />,
  task: <ListChecks {...ICON} />,
  agent: <Bot {...ICON} />,
  tool_call: <Wrench {...ICON} />,
  source_read: <Globe {...ICON} />,
  result: <Check {...ICON} />,
  artifact: <FileText {...ICON} />,
  adapter: <Plug {...ICON} />,
  system: <Terminal {...ICON} />,
};

export const fallbackKindIcon = <Activity {...ICON} />;

export const KIND_TONE: Record<ActivityKind, Tone> = {
  user_request: "blue",
  task: "cyan",
  agent: "green",
  tool_call: "violet",
  source_read: "teal",
  result: "green",
  artifact: "blue",
  adapter: "muted",
  system: "muted",
};

export const SEVERITY_TONE: Record<Severity, Tone> = { info: "cyan", warning: "amber", error: "red", critical: "red" };
export const STATUS_TONE: Record<ActivityEvent["status"], Tone> = {
  started: "cyan",
  running: "cyan",
  succeeded: "green",
  failed: "red",
  cancelled: "muted",
  info: "muted",
};

/* ── filters ──────────────────────────────────────────────────────────── */

export type TimeRange = "all" | "15m" | "1h" | "24h" | "7d";
export const TIME_RANGES: readonly TimeRange[] = ["all", "15m", "1h", "24h", "7d"];
const RANGE_MS: Record<Exclude<TimeRange, "all">, number> = { "15m": 15 * 60_000, "1h": 60 * 60_000, "24h": 24 * 60 * 60_000, "7d": 7 * 24 * 60 * 60_000 };

/** The eight filters of PLAN §29.3 plus a free-text search; an empty string means "all". */
export interface ActivityFilterState {
  agentId: string;
  taskId: string;
  tool: string;
  adapterId: string;
  severity: string;
  model: string;
  status: string;
  range: TimeRange;
  q: string;
}

export const EMPTY_FILTERS: ActivityFilterState = { agentId: "", taskId: "", tool: "", adapterId: "", severity: "", model: "", status: "", range: "all", q: "" };

export const isFiltered = (filters: ActivityFilterState): boolean => (Object.keys(EMPTY_FILTERS) as (keyof ActivityFilterState)[]).some((key) => filters[key] !== EMPTY_FILTERS[key]);

export function rangeStart(range: TimeRange, now: number): number | null {
  return range === "all" ? null : now - RANGE_MS[range];
}

/** Client-side predicate (live events never pass the server filter); `now` is passed in so the result is testable. */
export function matchesFilters(event: ActivityEvent, filters: ActivityFilterState, now: number): boolean {
  if (filters.agentId && event.agentId !== filters.agentId) return false;
  if (filters.taskId && event.taskId !== filters.taskId) return false;
  if (filters.tool && event.tool !== filters.tool) return false;
  if (filters.adapterId && (event.adapterId ?? event.source.adapterId) !== filters.adapterId) return false;
  if (filters.severity && event.severity !== filters.severity) return false;
  if (filters.model && event.model !== filters.model) return false;
  if (filters.status && event.status !== filters.status) return false;
  const start = rangeStart(filters.range, now);
  if (start !== null && Date.parse(event.occurredAt) < start) return false;
  const query = filters.q.trim().toLowerCase();
  if (query) {
    const haystack = [event.title, event.summary, event.result, event.tool, event.correlationId, event.id, event.error?.message].filter(Boolean).join(" ").toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

/** Filters the server can apply to older pages; the time range is anchored when the filter is set, not on every render. */
export function toServerFilters(filters: ActivityFilterState, rangeFrom: string | undefined): ActivityFilters {
  const server: ActivityFilters = {};
  if (filters.agentId) server.agentId = filters.agentId;
  if (filters.taskId) server.taskId = filters.taskId;
  if (filters.tool) server.tool = filters.tool;
  if (filters.adapterId) server.adapterId = filters.adapterId;
  if (filters.severity) server.severity = [filters.severity as Severity];
  if (filters.model) server.model = filters.model;
  if (filters.status) server.status = filters.status;
  if (rangeFrom) server.from = rangeFrom;
  return server;
}

/* ── buffer ───────────────────────────────────────────────────────────── */

/** Newest first: by occurrence time, then by sequence. */
export function compareNewestFirst(a: ActivityEvent, b: ActivityEvent): number {
  const byTime = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
  return byTime !== 0 && !Number.isNaN(byTime) ? byTime : b.sequence - a.sequence;
}

/** Adds events to the buffer (newest copy by `version` wins) and drops the oldest beyond `cap`. Pure besides `buffer`. */
export function addToBuffer(buffer: Map<string, ActivityEvent>, events: readonly ActivityEvent[], cap: number): void {
  for (const event of events) {
    const existing = buffer.get(event.id);
    if (!existing || event.version >= existing.version) buffer.set(event.id, event);
  }
  if (buffer.size > cap) {
    const sorted = [...buffer.values()].sort(compareNewestFirst);
    for (const event of sorted.slice(cap)) buffer.delete(event.id);
  }
}

/* ── tree ─────────────────────────────────────────────────────────────── */

export interface ActivityRowModel {
  event: ActivityEvent;
  depth: number;
  childCount: number;
  collapsed: boolean;
}

/**
 * User Request -> Task -> Agent -> Tool Call / Source Read / Result -> Artifact (PLAN §29.4) from `parentId`.
 * Roots are newest first, children chronological (a call precedes its result). Events whose parent is not part of
 * `events` (filtered out or not loaded) become roots, so nothing disappears. Iterative: 10 000 events are fine.
 */
export function buildActivityTree(events: readonly ActivityEvent[], collapsed: ReadonlySet<string>): ActivityRowModel[] {
  const byId = new Map<string, ActivityEvent>();
  for (const event of events) byId.set(event.id, event);
  const children = new Map<string, ActivityEvent[]>();
  const roots: ActivityEvent[] = [];
  for (const event of events) {
    const parent = event.parentId;
    if (parent && parent !== event.id && byId.has(parent)) {
      const bucket = children.get(parent);
      if (bucket) bucket.push(event);
      else children.set(parent, [event]);
    } else roots.push(event);
  }
  roots.sort(compareNewestFirst);
  for (const bucket of children.values()) bucket.sort((a, b) => -compareNewestFirst(a, b));

  const descendants = new Map<string, number>();
  const countDescendants = (id: string): number => {
    // Post-order without recursion: a stack of [id, visited-children flag].
    const stack: [string, boolean][] = [[id, false]];
    const seen = new Set<string>([id]); // guards parent cycles
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as [string, boolean];
      const kids = children.get(top[0]) ?? [];
      if (!top[1]) {
        top[1] = true;
        for (const kid of kids) {
          if (descendants.has(kid.id) || seen.has(kid.id)) continue;
          seen.add(kid.id);
          stack.push([kid.id, false]);
        }
      } else {
        stack.pop();
        descendants.set(top[0], kids.reduce((sum, kid) => sum + 1 + (descendants.get(kid.id) ?? 0), 0));
      }
    }
    return descendants.get(id) ?? 0;
  };

  const rows: ActivityRowModel[] = [];
  const visited = new Set<string>();
  const walk = (root: ActivityEvent): void => {
    const stack: { event: ActivityEvent; depth: number }[] = [{ event: root, depth: 0 }];
    while (stack.length > 0) {
      const { event, depth } = stack.pop() as { event: ActivityEvent; depth: number };
      if (visited.has(event.id)) continue;
      visited.add(event.id);
      const childCount = countDescendants(event.id);
      const isCollapsed = collapsed.has(event.id);
      rows.push({ event, depth, childCount, collapsed: isCollapsed });
      if (isCollapsed) {
        // Hidden, not lost: mark the whole branch as handled so the cycle fallback below does not list it as roots.
        const hidden = [...(children.get(event.id) ?? [])];
        while (hidden.length > 0) {
          const next = hidden.pop() as ActivityEvent;
          if (visited.has(next.id)) continue;
          visited.add(next.id);
          hidden.push(...(children.get(next.id) ?? []));
        }
        continue;
      }
      const kids = children.get(event.id) ?? [];
      for (let index = kids.length - 1; index >= 0; index -= 1) stack.push({ event: kids[index] as ActivityEvent, depth: depth + 1 });
    }
  };
  for (const root of roots) walk(root);
  // Parent cycles never reach a root; show their members as roots instead of dropping them.
  for (const event of events) if (!visited.has(event.id)) walk(event);
  return rows;
}
