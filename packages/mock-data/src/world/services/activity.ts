import type { ActivityEvent } from "@friday/sdk";
import { notFound, validationFailed } from "../../core/errors";
import { asIso, asList, clone, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import { ACTIVITY_KINDS, checkEnum, pageOf, SEVERITIES, type Query } from "./shared";

export type ActivityListQuery = Query<"listActivity">;

const ACTIVITY_STATUSES = ["started", "running", "succeeded", "failed", "cancelled", "info"];

export class ActivityService {
  constructor(private readonly w: MockWorld) {}

  /**
   * Newest first. With `sinceSequence` the result is ascending (oldest first) so a client can replay missed events
   * in order after a reconnect.
   */
  list(query: ActivityListQuery = {}): Page<ActivityEvent> {
    return this.w.read("listActivity", () => {
      const kinds = asList(query.kind);
      const severities = asList(query.severity);
      checkEnum("kind", kinds, ACTIVITY_KINDS);
      checkEnum("severity", severities, SEVERITIES);
      if (query.status) checkEnum("status", [query.status], ACTIVITY_STATUSES);
      let since: number | undefined;
      if (query.sinceSequence !== undefined && String(query.sinceSequence) !== "") {
        since = Number(query.sinceSequence);
        if (!Number.isInteger(since) || since < 0) throw validationFailed("sinceSequence muss eine ganze Zahl >= 0 sein.", [{ path: "sinceSequence", message: "ganze Zahl erwartet" }]);
      }
      const from = asIso(query.from, "from");
      const to = asIso(query.to, "to");
      const parentFilter = query.parentId === "null" ? null : query.parentId;
      const items = this.w.state.activity.filter((event) => {
        if (since !== undefined && event.sequence <= since) return false;
        if (kinds.length && !kinds.includes(event.kind)) return false;
        if (severities.length && !severities.includes(event.severity)) return false;
        if (query.agentId && event.agentId !== query.agentId) return false;
        if (query.taskId && event.taskId !== query.taskId) return false;
        if (query.tool && event.tool !== query.tool) return false;
        if (query.adapterId && event.adapterId !== query.adapterId) return false;
        if (query.model && event.model !== query.model) return false;
        if (query.status && event.status !== query.status) return false;
        if (query.correlationId && event.correlationId !== query.correlationId) return false;
        if (parentFilter !== undefined && event.parentId !== parentFilter) return false;
        const at = Date.parse(event.occurredAt);
        if (from !== undefined && at < from) return false;
        if (to !== undefined && at > to) return false;
        return true;
      });
      const ordered = since !== undefined ? items : [...items].reverse();
      return pageOf(ordered, query);
    });
  }

  get(id: string): ActivityEvent {
    return this.w.read("getActivityEvent", () => {
      const event = this.w.state.activity.find((candidate) => candidate.id === id);
      if (!event) throw notFound("Aktivitätsereignis", id);
      return clone(event);
    });
  }
}
