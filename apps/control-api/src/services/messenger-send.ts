import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Db } from "../db/database";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";
import type { ApprovalTokenService } from "@friday/auth";

const sha = (input: string) => createHash("sha256").update(input).digest("hex");
const PLATFORM = new Set(["telegram", "discord", "whatsapp", "slack", "signal", "matrix", "mattermost", "sms",
  "irc", "line", "feishu", "wecom", "photon", "buzz", "ntfy"]);
const TARGET = /^[A-Za-z0-9_@.!+#:;-]{1,128}$/;
export interface MessengerDraft { accountId: "default"; platform: string; recipient: string; text: string }
export interface MessengerTarget { id: string; accountId: string; platform: string; recipient: string; createdAt: string }
export interface MessengerReceipt { receiptId: string; accountId: string; platform: string; recipient: string;
  state: "pending" | "sent" | "uncertain"; externalId: string | null; createdAt: string; replayed: boolean }
type RunnerResult = { state?: string; externalId?: string | null; reason?: string; revision?: string };

function validTarget(platform: string, recipient: string): boolean {
  if (typeof platform !== "string" || typeof recipient !== "string" || !PLATFORM.has(platform) || !TARGET.test(recipient)) return false;
  switch (platform) {
    case "telegram": return /^-?[0-9]{5,20}(?::[0-9]+)?$/.test(recipient);
    case "discord": return /^[0-9]{10,20}(?::[0-9]{10,20})?$/.test(recipient);
    case "whatsapp": return /^\+[1-9][0-9]{6,14}$/.test(recipient) || /^[A-Za-z0-9_-]+@(g\.us|s\.whatsapp\.net|lid|broadcast|newsletter)$/.test(recipient);
    case "slack": return /^[CGD][A-Z0-9]{8,}$/.test(recipient);
    case "signal":
    case "sms": return /^\+[1-9][0-9]{6,14}$/.test(recipient);
    case "matrix": return /^[@!][A-Za-z0-9_.=-]+:[A-Za-z0-9.-]+$/.test(recipient);
    case "mattermost": return /^[a-z0-9]{26}$/.test(recipient);
    case "irc": return /^#[A-Za-z0-9_-]{1,64}$/.test(recipient);
    case "line": return /^[UCR][0-9a-f]{32}$/.test(recipient);
    case "feishu": return /^(oc|ou|on|chat|open)_[A-Za-z0-9-]+$/.test(recipient);
    case "wecom": return /^[A-Za-z0-9_-]{1,128}$/.test(recipient);
    case "photon": return /^any;-;\+[0-9]{6,15}$/.test(recipient);
    case "buzz": return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipient);
    case "ntfy": return /^[A-Za-z0-9_-]{1,128}$/.test(recipient);
    default: return false;
  }
}

function validate(draft: MessengerDraft): void {
  if (!draft || draft.accountId !== "default" || !validTarget(draft.platform, draft.recipient) ||
      typeof draft.text !== "string" || !draft.text.trim() || Buffer.byteLength(draft.text, "utf8") > 8192 ||
      draft.text.includes("MEDIA:") || draft.text.includes("[[as_document]]")) {
    throw validationFailed("Kanal, exakter Empfänger oder Nachricht ist ungültig.");
  }
}

export class MessengerSendService {
  constructor(private readonly db: Db, private readonly dataDir: string, private readonly approvals: ApprovalTokenService,
    private readonly invoke: RunnerInvoker = invokeCodingRunner) {
    // A previous process may have reached the network but died before recording a result.
    this.db.prepare("UPDATE messenger_send_journal SET state='uncertain',updated_at=? WHERE state='pending'")
      .run(new Date().toISOString());
  }

  targets(actor: string): MessengerTarget[] {
    const rows = this.db.prepare(`SELECT id,account_id,platform,recipient,created_at
      FROM messenger_outbound_targets WHERE actor=? ORDER BY platform,recipient LIMIT 200`).all(actor) as unknown as Array<{
        id: string; account_id: string; platform: string; recipient: string; created_at: string }>;
    return rows.map((row) => ({ id: row.id, accountId: row.account_id, platform: row.platform,
      recipient: row.recipient, createdAt: row.created_at }));
  }

  register(actor: string, input: Pick<MessengerDraft, "accountId" | "platform" | "recipient">): MessengerTarget {
    if (!input || input.accountId !== "default" || !validTarget(input.platform, input.recipient))
      throw validationFailed("Kanal oder exakte Empfänger-ID ist ungültig.");
    const id = sha(randomUUID());
    this.db.prepare(`INSERT OR IGNORE INTO messenger_outbound_targets
      (id,actor,account_id,platform,recipient,created_at) VALUES (?,?,?,?,?,?)`)
      .run(id, actor, input.accountId, input.platform, input.recipient, new Date().toISOString());
    const row = this.db.prepare(`SELECT id,account_id,platform,recipient,created_at
      FROM messenger_outbound_targets WHERE actor=? AND account_id=? AND platform=? AND recipient=?`)
      .get(actor, input.accountId, input.platform, input.recipient) as {
        id: string; account_id: string; platform: string; recipient: string; created_at: string };
    return { id: row.id, accountId: row.account_id, platform: row.platform,
      recipient: row.recipient, createdAt: row.created_at };
  }

  remove(actor: string, id: string): MessengerTarget {
    if (!/^[a-f0-9]{64}$/.test(id)) throw validationFailed("Empfänger-ID ist ungültig.");
    const row = this.db.prepare(`SELECT id,account_id,platform,recipient,created_at
      FROM messenger_outbound_targets WHERE actor=? AND id=?`).get(actor, id) as {
        id: string; account_id: string; platform: string; recipient: string; created_at: string } | undefined;
    if (!row) throw validationFailed("Empfänger-ID ist nicht registriert.");
    this.db.prepare("DELETE FROM messenger_outbound_targets WHERE id=? AND actor=?").run(id, actor);
    return { id: row.id, accountId: row.account_id, platform: row.platform,
      recipient: row.recipient, createdAt: row.created_at };
  }

  private admitted(actor: string, draft: MessengerDraft): string | null {
    const row = this.db.prepare(`SELECT id FROM messenger_outbound_targets
      WHERE actor=? AND account_id=? AND platform=? AND recipient=?`).get(actor, draft.accountId, draft.platform, draft.recipient) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private target(): { script: string; distro: string; user: string } {
    let root = resolve(this.dataDir);
    for (let depth = 0; depth < 5 && !existsSync(join(root, "config", "install-state.json")); depth += 1) root = resolve(root, "..");
    let state: { distro_name?: string; linux_user?: string };
    try { state = JSON.parse(readFileSync(join(root, "config", "install-state.json"), "utf8").replace(/^\uFEFF/, "")) as typeof state; }
    catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Hermes-Installation fehlt." }); }
    const match = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!match || !state.distro_name || !/^[A-Za-z0-9_.-]+$/.test(state.distro_name) ||
        !state.linux_user || !/^[A-Za-z0-9_-]+$/.test(state.linux_user)) {
      throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Hermes-Installation ist ungültig." });
    }
    return { distro: state.distro_name, user: state.linux_user,
      script: `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replaceAll("\\", "/")}/installer/wsl/messaging_send.py` };
  }

  private async run(action: "check" | "send", draft: MessengerDraft): Promise<RunnerResult> {
    const { script, distro, user } = this.target();
    try {
      return await this.invoke(script, distro, user, [], JSON.stringify({ action, platform: draft.platform,
        recipient: draft.recipient, text: draft.text }), action === "check" ? 10000 : 45000) as RunnerResult;
    } catch {
      return { state: action === "send" ? "uncertain" : "rejected" };
    }
  }

  private fingerprint(actor: string, draft: MessengerDraft, revision: string, targetId: string): string {
    return sha(JSON.stringify([actor, draft.accountId, draft.platform, draft.recipient, draft.text, revision, targetId]));
  }

  private draftHash(actor: string, draft: MessengerDraft): string {
    return sha(JSON.stringify([actor, draft.accountId, draft.platform, draft.recipient, draft.text]));
  }

  async preview(actor: string, draft: MessengerDraft): Promise<{ token: string; expiresAt: string; fingerprint: string;
    draft: MessengerDraft }> {
    validate(draft);
    const targetId = this.admitted(actor, draft);
    if (!targetId) throw validationFailed("Empfänger ist für dieses Konto nicht registriert.");
    const ready = await this.run("check", draft);
    if (ready.state !== "configured" || !ready.revision) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Hermes-Kanal ist nicht konfiguriert." });
    const fingerprint = this.fingerprint(actor, draft, ready.revision, targetId);
    const { token, claims } = this.approvals.issue({ approvalId: fingerprint, userId: actor, action: "messenger.send" });
    return { token, expiresAt: new Date(claims.expiresAt).toISOString(), fingerprint, draft };
  }

  async confirm(actor: string, draft: MessengerDraft, token: string, key: string): Promise<MessengerReceipt> {
    validate(draft);
    if (typeof token !== "string" || !key || key.length < 8 || key.length > 128) throw validationFailed("Freigabe oder Idempotency-Key fehlt.");
    const keyHash = sha(JSON.stringify([actor, draft.accountId, key]));
    const existing = this.lookup(keyHash);
    if (existing) return this.replay(keyHash, existing, this.draftHash(actor, draft));
    const targetId = this.admitted(actor, draft);
    if (!targetId) throw validationFailed("Empfänger ist für dieses Konto nicht registriert.");
    const ready = await this.run("check", draft);
    if (ready.state !== "configured" || !ready.revision) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Hermes-Kanal ist nicht konfiguriert." });
    const payloadHash = this.fingerprint(actor, draft, ready.revision, targetId);
    const valid = this.approvals.consume(token, { approvalId: payloadHash, userId: actor, action: "messenger.send" });
    if (!valid.ok) throw conflict("Nachricht oder Empfänger wurde geändert; bitte neu freigeben.");
    const now = new Date().toISOString();
    const inserted = this.db.prepare(`INSERT OR IGNORE INTO messenger_send_journal
      (key_hash,actor,account_id,platform,recipient,payload_hash,draft_hash,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'pending',?,?)`).run(keyHash, actor, draft.accountId, draft.platform, draft.recipient,
      payloadHash, this.draftHash(actor, draft), now, now).changes;
    if (!inserted) return this.replay(keyHash, this.lookup(keyHash)!, this.draftHash(actor, draft));
    const result = await this.run("send", draft);
    const state = result.state === "sent" ? "sent" : "uncertain";
    this.db.prepare("UPDATE messenger_send_journal SET state=?,external_id=?,updated_at=? WHERE key_hash=?")
      .run(state, state === "sent" && typeof result.externalId === "string" ? result.externalId : null,
        new Date().toISOString(), keyHash);
    return this.replay(keyHash, this.lookup(keyHash)!, this.draftHash(actor, draft), false);
  }

  receipts(actor: string): MessengerReceipt[] {
    const rows = this.db.prepare(`SELECT key_hash,account_id,platform,recipient,payload_hash,state,external_id,created_at
      FROM messenger_send_journal WHERE actor=? ORDER BY created_at DESC LIMIT 50`).all(actor) as unknown as Array<JournalRow & { key_hash: string }>;
    return rows.map((row) => this.public(row.key_hash, row, false));
  }

  private lookup(keyHash: string): JournalRow | undefined {
    return this.db.prepare(`SELECT account_id,platform,recipient,payload_hash,draft_hash,state,external_id,created_at
      FROM messenger_send_journal WHERE key_hash=?`).get(keyHash) as JournalRow | undefined;
  }

  private replay(keyHash: string, row: JournalRow, draftHash: string, replayed = true): MessengerReceipt {
    if (row.draft_hash !== draftHash) throw conflict("Idempotency-Key wurde für eine andere Nachricht verwendet.");
    return this.public(keyHash, row, replayed);
  }

  private public(keyHash: string, row: JournalRow, replayed: boolean): MessengerReceipt {
    return { receiptId: keyHash, accountId: row.account_id, platform: row.platform, recipient: row.recipient,
      state: row.state, externalId: row.external_id, createdAt: row.created_at, replayed };
  }
}

interface JournalRow { account_id: string; platform: string; recipient: string; payload_hash: string; draft_hash: string | null;
  state: "pending" | "sent" | "uncertain"; external_id: string | null; created_at: string }
