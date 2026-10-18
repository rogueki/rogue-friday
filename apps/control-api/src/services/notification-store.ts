import type { Notification } from "@friday/sdk";
import type { Db } from "../db/database";

/** Durable local source of truth for Friday-created notifications; no provider sends occur in this store. */
export class NotificationStore {
  constructor(private readonly db: Db) {}

  get(id: string): Notification | undefined {
    const row = this.db.prepare("SELECT json FROM notifications WHERE id = ?").get(id) as { json: string } | undefined;
    return row ? JSON.parse(row.json) as Notification : undefined;
  }

  list(): Notification[] {
    const rows = this.db.prepare("SELECT json FROM notifications ORDER BY created_at DESC, id DESC").all() as Array<{ json: string }>;
    return rows.map((row) => JSON.parse(row.json) as Notification);
  }

  save(notification: Notification, pendingDispatch = notification.escalation.some((step) => step.state === "pending")): void {
    this.db.prepare(`
      INSERT INTO notifications (id, created_at, updated_at, resolved_at, status, pending_dispatch, json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        resolved_at = excluded.resolved_at,
        status = excluded.status,
        pending_dispatch = excluded.pending_dispatch,
        json = excluded.json
    `).run(
      notification.id,
      notification.createdAt,
      notification.updatedAt,
      notification.resolvedAt ?? null,
      notification.status,
      pendingDispatch ? 1 : 0,
      JSON.stringify(notification),
    );
  }

  countResolvedBefore(cutoffIso: string): number {
    this.validateCutoff(cutoffIso);
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM notifications
      WHERE status = 'resolved' AND resolved_at IS NOT NULL AND resolved_at < ? AND pending_dispatch = 0
    `).get(cutoffIso) as { count: number };
    return Number(row.count);
  }

  deleteResolvedBefore(cutoffIso: string): number {
    this.validateCutoff(cutoffIso);
    return Number(this.db.prepare(`
      DELETE FROM notifications
      WHERE status = 'resolved' AND resolved_at IS NOT NULL AND resolved_at < ? AND pending_dispatch = 0
    `).run(cutoffIso).changes);
  }

  private validateCutoff(cutoffIso: string): void {
    if (!Number.isFinite(Date.parse(cutoffIso))) throw new TypeError("Notification retention cutoff must be an ISO date-time");
  }
}
