import { createHash } from "node:crypto";
import type { Db } from "../db/database";
import { stableUserId } from "../security/auth-service";
import type { DurableMemoryService, IntegrationEvent } from "./durable-memory";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const PLATFORMS = new Set(["telegram", "discord", "whatsapp", "whatsapp_cloud", "slack", "signal", "mattermost",
  "matrix", "sms", "dingtalk", "feishu", "wecom", "weixin", "bluebubbles", "qqbot", "yuanbao", "teams",
  "buzz", "google_chat", "irc", "line", "ntfy", "photon", "simplex"]);
const privateText = /\b(?:(?:nicht speichern|nicht merken|vergiss (?:dieses |diese )?(?:gespr[aä]ch|unterhaltung|chat))|private[rnms]? modus|do not (?:store|remember|save) (?:this |the )?(?:conversation|chat)|off the record)\b/i;
const secretCue = /\b(?:password|passwort|passphrase|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|secret|geheimnis|otp|einmalcode|private[ _-]?key|bearer|authorization|kennwort|zugangsdaten)\b|\bpin\s*(?:[:=]|is\b|lautet\b)/i;
const secretValue = /\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{16,}|(?:\d[ -]*?){13,19})\b/;
const sourceId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128 &&
  Array.from(value).every((char) => char.codePointAt(0)! >= 32 && char.codePointAt(0)! !== 127);
/** Durable memory rejects a known event id whose stored content differs — for a re-delivered messenger
 *  message that is not an error, the first capture already happened. */
const isEventIdConflict = (error: unknown): boolean => error instanceof Error && error.message === "Event ID conflict";

export interface InboundMessage { platform: string; accountId: string; accountEpoch: string; senderId: string; chatId: string;
  chatType: string; messageId: string; text: string;
  eventType?: "assistant_response" | "action_result"; admissionEventId?: string; turnId?: string;
  actionId?: string; outcome?: "completed" | "aborted" | "uncertain";
  suppressionReason?: "private" | "policy_disabled" | "not_private_dm" | "unsupported_profile" | "multi_profile_unknown" | "account_changed" }
export interface SenderObservation { id: string; platform: string; accountId: string; senderId: string;
  chatId: string; lastSeenAt: string; linked: boolean }
export type InboundReason = "captured" | "pending" | "unlinked" | "policy_disabled" | "private" | "not_private_dm" | "unsupported_profile" | "multi_profile_unknown" | "account_changed" | "invalid";
export interface InboundReceipt { reason: InboundReason; eventId: string | null;
  context?: Array<{ source: string; occurredAt: string; text: string }> }

export class MessengerInboundService {
  constructor(private readonly db: Db, private readonly memory: DurableMemoryService) {
    db.exec(`CREATE TABLE IF NOT EXISTS messenger_sender_observations (
      id TEXT PRIMARY KEY, platform TEXT NOT NULL, account_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      chat_id TEXT NOT NULL, last_seen_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messenger_identity_links (
        observation_id TEXT PRIMARY KEY REFERENCES messenger_sender_observations(id) ON DELETE CASCADE,
        identity_id TEXT NOT NULL, linked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messenger_inbound_events (
        id TEXT PRIMARY KEY, observation_id TEXT NOT NULL, occurred_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messenger_turn_events (
        id TEXT PRIMARY KEY, admission_id TEXT NOT NULL, occurred_at TEXT NOT NULL);`);
  }

  observations(): SenderObservation[] {
    const rows = this.db.prepare(`SELECT o.id,o.platform,o.account_id,o.sender_id,o.chat_id,o.last_seen_at,
      l.identity_id FROM messenger_sender_observations o LEFT JOIN messenger_identity_links l ON l.observation_id=o.id
      ORDER BY o.last_seen_at DESC LIMIT 100`).all() as unknown as Array<{ id: string; platform: string; account_id: string;
        sender_id: string; chat_id: string; last_seen_at: string; identity_id: string | null }>;
    return rows.map((row) => ({ id: row.id, platform: row.platform, accountId: row.account_id,
      senderId: row.sender_id, chatId: row.chat_id, lastSeenAt: row.last_seen_at, linked: row.identity_id !== null }));
  }

  observation(id: string): SenderObservation | null {
    if (!/^[a-f0-9]{64}$/.test(id)) return null;
    const row = this.db.prepare(`SELECT o.id,o.platform,o.account_id,o.sender_id,o.chat_id,o.last_seen_at,
      l.identity_id FROM messenger_sender_observations o LEFT JOIN messenger_identity_links l ON l.observation_id=o.id
      WHERE o.id=?`).get(id) as { id: string; platform: string; account_id: string; sender_id: string;
        chat_id: string; last_seen_at: string; identity_id: string | null } | undefined;
    return row ? { id: row.id, platform: row.platform, accountId: row.account_id, senderId: row.sender_id,
      chatId: row.chat_id, lastSeenAt: row.last_seen_at, linked: row.identity_id !== null } : null;
  }

  link(id: string, ownerId: string): SenderObservation | null {
    if (!/^[a-f0-9]{64}$/.test(id) || ownerId !== stableUserId("owner")) return null;
    const row = this.db.prepare("SELECT id FROM messenger_sender_observations WHERE id=?").get(id);
    if (!row) return null;
    this.db.prepare(`INSERT INTO messenger_identity_links VALUES (?,?,?)
      ON CONFLICT(observation_id) DO UPDATE SET identity_id=excluded.identity_id,linked_at=excluded.linked_at`)
      .run(id, ownerId, new Date().toISOString());
    return this.observation(id);
  }

  unlink(id: string): void {
    if (!/^[a-f0-9]{64}$/.test(id)) return;
    this.db.prepare("DELETE FROM messenger_identity_links WHERE observation_id=?").run(id);
  }

  receive(input: InboundMessage): InboundReceipt {
    if (!PLATFORMS.has(input.platform) || input.accountId !== "default" || !/^[a-f0-9]{64}$/.test(input.accountEpoch) ||
        !sourceId(input.senderId) || !sourceId(input.chatId) || !sourceId(input.messageId) ||
        typeof input.text !== "string" || input.text.length > 200_000) return { reason: "invalid", eventId: null };
    if (input.suppressionReason) {
      if (input.text !== "") return { reason: "invalid", eventId: null };
      return { reason: input.suppressionReason, eventId: null };
    }
    if (input.chatType !== "dm") return { reason: "not_private_dm", eventId: null };
    const settings = this.memory.getSettings();
    if (!settings.enabled || settings.privateMode || settings.channels.messenger !== true)
      return { reason: "policy_disabled", eventId: null };
    if (privateText.test(input.text) || secretCue.test(input.text) || secretValue.test(input.text))
      return { reason: "private", eventId: null };
    if (input.eventType) return this.receiveTurn(input);
    if (input.admissionEventId !== undefined || input.turnId !== undefined ||
        input.actionId !== undefined || input.outcome !== undefined)
      return { reason: "invalid", eventId: null };
    const now = new Date().toISOString();
    const id = sha(JSON.stringify([input.platform, input.accountId, input.accountEpoch, input.senderId]));
    this.db.prepare(`INSERT INTO messenger_sender_observations VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id,last_seen_at=excluded.last_seen_at`)
      .run(id, input.platform, input.accountId, input.senderId, input.chatId, now);
    const linked = this.db.prepare("SELECT identity_id FROM messenger_identity_links WHERE observation_id=?").get(id) as
      { identity_id: string } | undefined;
    if (!linked || linked.identity_id !== stableUserId("owner")) return { reason: "unlinked", eventId: null };
    const eventId = `messenger-${sha(JSON.stringify([input.platform, input.accountId, input.accountEpoch, input.senderId, input.messageId]))}`;
    this.db.prepare("INSERT OR IGNORE INTO messenger_inbound_events VALUES (?,?,?)").run(eventId, id, now);
    const record = this.db.prepare("SELECT observation_id,occurred_at FROM messenger_inbound_events WHERE id=?").get(eventId) as
      { observation_id: string; occurred_at: string };
    if (record.observation_id !== id) return { reason: "invalid", eventId: null };
    const event: IntegrationEvent = { eventId, contractVersion: "1.0.0", eventType: "user_utterance",
      actor: { type: "user", id: linked.identity_id, role: null }, identityId: linked.identity_id,
      channel: "messenger", sessionId: `messenger-${sha(JSON.stringify([input.platform, input.accountId, input.accountEpoch, input.chatId])).slice(0, 32)}`,
      dialogId: null, correlationId: null, source: `messenger/${input.platform}/${sha(input.senderId).slice(0, 16)}`,
      occurredAt: record.occurred_at, outcome: "completed", captureEligibility: "eligible", redaction: "required",
      payload: { kind: "text", text: input.text } };
    let result: { eventId: string; accepted: boolean; pending: boolean };
    try { result = this.memory.capture(event); }
    catch (error) {
      // The platform re-delivered this message id with a different receipt time. The first capture
      // stands, so the delivery is idempotent instead of a 5xx; an edited re-delivery keeps the
      // already stored text.
      if (isEventIdConflict(error)) return { reason: "captured", eventId };
      this.db.prepare("DELETE FROM messenger_inbound_events WHERE id=?").run(eventId);
      throw error;
    }
    const reason = result.pending ? "pending" : result.accepted ? "captured" : "policy_disabled";
    if (reason === "policy_disabled") {
      this.db.prepare("DELETE FROM messenger_inbound_events WHERE id=?").run(eventId);
      return { reason, eventId: null };
    }
    try {
      const hits = this.memory.search(input.text.slice(0, 240), linked.identity_id, 5);
      const context = hits.filter((hit) => hit.eventId !== eventId && !privateText.test(hit.text) &&
        !secretCue.test(hit.text) && !secretValue.test(hit.text)).slice(0, 5).map((hit) => ({ source: hit.source.slice(0, 80),
        occurredAt: hit.occurredAt.slice(0, 40), text: hit.text.slice(0, 600) }));
      return context.length ? { reason, eventId, context } : { reason, eventId };
    } catch { return { reason, eventId }; }
  }

  private receiveTurn(input: InboundMessage): InboundReceipt {
    if ((input.eventType !== "assistant_response" && input.eventType !== "action_result") ||
        !input.admissionEventId || !/^messenger-[a-f0-9]{64}$/.test(input.admissionEventId) ||
        !input.turnId || !sourceId(input.turnId) ||
        input.eventType === "action_result" && (input.text !== "" || !input.actionId ||
          !/^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$/.test(input.actionId) ||
          !["completed", "aborted", "uncertain"].includes(input.outcome ?? "")) ||
        input.eventType === "assistant_response" && (!input.text.trim() ||
          input.actionId !== undefined || input.outcome !== undefined))
      return { reason: "invalid", eventId: null };
    const id = sha(JSON.stringify([input.platform, input.accountId, input.accountEpoch, input.senderId]));
    const admission = this.db.prepare(`SELECT e.observation_id, o.chat_id, l.identity_id
      FROM messenger_inbound_events e JOIN messenger_sender_observations o ON o.id=e.observation_id
      LEFT JOIN messenger_identity_links l ON l.observation_id=o.id WHERE e.id=?`).get(input.admissionEventId) as
      { observation_id: string; chat_id: string; identity_id: string | null } | undefined;
    if (!admission || admission.observation_id !== id || admission.chat_id !== input.chatId ||
        admission.identity_id !== stableUserId("owner")) return { reason: "unlinked", eventId: null };
    const eventId = `messenger-${sha(JSON.stringify([input.admissionEventId, input.turnId, input.eventType,
      input.actionId ?? null]))}`;
    this.db.prepare("INSERT OR IGNORE INTO messenger_turn_events VALUES (?,?,?)")
      .run(eventId, input.admissionEventId, new Date().toISOString());
    const turn = this.db.prepare("SELECT admission_id,occurred_at FROM messenger_turn_events WHERE id=?").get(eventId) as
      { admission_id: string; occurred_at: string };
    if (turn.admission_id !== input.admissionEventId) return { reason: "invalid", eventId: null };
    const sessionId = `messenger-${sha(JSON.stringify([input.platform, input.accountId, input.accountEpoch, input.chatId])).slice(0, 32)}`;
    const event: IntegrationEvent = { eventId, contractVersion: "1.0.0", eventType: input.eventType,
      actor: { type: "assistant", id: "friday", role: null }, identityId: admission.identity_id,
      channel: "messenger", sessionId, dialogId: null, correlationId: input.admissionEventId,
      source: `messenger/${input.platform}/${sha(input.senderId).slice(0, 16)}`,
      occurredAt: turn.occurred_at, outcome: input.eventType === "action_result" ? input.outcome! : "completed",
      captureEligibility: "eligible", redaction: "required", payload: input.eventType === "action_result" ?
        { kind: "action", actionId: input.actionId!, targetId: null, externalId: null } : { kind: "text", text: input.text } };
    let result: { eventId: string; accepted: boolean; pending: boolean };
    try { result = this.memory.capture(event); }
    catch (error) {
      // Same idempotency rule as for the user utterance above: a repeated turn is not a failure.
      if (isEventIdConflict(error)) return { reason: "captured", eventId };
      this.db.prepare("DELETE FROM messenger_turn_events WHERE id=?").run(eventId);
      throw error;
    }
    if (!result.pending && !result.accepted)
      this.db.prepare("DELETE FROM messenger_turn_events WHERE id=?").run(eventId);
    return { reason: result.pending ? "pending" : result.accepted ? "captured" : "policy_disabled",
      eventId: result.pending || result.accepted ? eventId : null };
  }
}
