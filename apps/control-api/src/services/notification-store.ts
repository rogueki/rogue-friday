import type { Notification } from "@friday/sdk";
import { randomUUID } from "node:crypto";
import type { Db } from "../db/database";
import { conflict, notFound } from "../util/errors";

export interface NotificationMessengerDraft { accountId: "default"; platform: string; recipient: string; text: string }
export interface NotificationMessengerStage { notificationId: string; step: number; actor: string; idempotencyKey: string;
  draft: NotificationMessengerDraft; state: "staged" | "sent" | "uncertain" }

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

  stageMessengerDraft(notificationId: string, step: number, actor: string, draft: NotificationMessengerDraft): NotificationMessengerStage {
    const notification = this.get(notificationId);
    if (!notification) throw notFound("Benachrichtigung", notificationId);
    const escalation = notification.escalation.find((item) => item.step === step);
    if ((notification.status !== "open" && !(notification.status === "acknowledged" && escalation?.stopOnAcknowledge === false)) ||
        escalation?.state !== "awaiting_approval" || escalation.channel !== draft.platform)
      throw conflict("Der Messenger-Schritt ist nicht mehr zur Freigabe verfügbar.");
    const serialized = JSON.stringify(draft);
    const previous = this.db.prepare(`SELECT actor,idempotency_key,draft_json,state FROM notification_messenger_stages
      WHERE notification_id=? AND step=?`).get(notificationId, step) as { actor: string; idempotency_key: string; draft_json: string; state: NotificationMessengerStage["state"] } | undefined;
    if (previous) {
      if (previous.actor !== actor || previous.draft_json !== serialized)
        throw conflict("Für diesen Eskalationsschritt ist bereits ein anderer unveränderlicher Versandentwurf hinterlegt.");
      return { notificationId, step, actor, idempotencyKey: previous.idempotency_key, draft, state: previous.state };
    }
    const idempotencyKey = randomUUID();
    this.db.prepare(`INSERT INTO notification_messenger_stages
      (notification_id,step,actor,idempotency_key,draft_json,state,updated_at) VALUES (?,?,?,?,?,'staged',?)`)
      .run(notificationId, step, actor, idempotencyKey, serialized, new Date().toISOString());
    return { notificationId, step, actor, idempotencyKey, draft, state: "staged" };
  }

  messengerStage(notificationId: string, step: number, actor: string): NotificationMessengerStage {
    const row = this.db.prepare(`SELECT actor,idempotency_key,draft_json,state FROM notification_messenger_stages
      WHERE notification_id=? AND step=?`).get(notificationId, step) as { actor: string; idempotency_key: string; draft_json: string; state: NotificationMessengerStage["state"] } | undefined;
    if (!row || row.actor !== actor) throw notFound("Messenger-Freigabe", `${notificationId}/${step}`);
    return { notificationId, step, actor, idempotencyKey: row.idempotency_key,
      draft: JSON.parse(row.draft_json) as NotificationMessengerDraft, state: row.state };
  }

  completeMessengerStage(notificationId: string, step: number, actor: string, idempotencyKey: string,
    receipt: { state: "sent" | "uncertain"; receiptId: string }): void {
    const changed = this.db.prepare(`UPDATE notification_messenger_stages SET state=?,receipt_json=?,updated_at=?
      WHERE notification_id=? AND step=? AND actor=? AND idempotency_key=?`)
      .run(receipt.state, JSON.stringify(receipt), new Date().toISOString(), notificationId, step, actor, idempotencyKey).changes;
    if (!changed) throw conflict("Die dauerhafte Messenger-Zuordnung stimmt nicht mehr.");
  }

  private validateCutoff(cutoffIso: string): void {
    if (!Number.isFinite(Date.parse(cutoffIso))) throw new TypeError("Notification retention cutoff must be an ISO date-time");
  }
}
