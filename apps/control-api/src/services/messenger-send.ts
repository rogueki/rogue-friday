import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Db } from "../db/database";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";
import type { ApprovalTokenService } from "@friday/auth";

const sha = (input: string) => createHash("sha256").update(input).digest("hex");
const PLATFORM = new Set(["telegram", "discord", "whatsapp", "slack", "signal", "matrix", "mattermost", "sms",
  "irc", "line", "feishu", "teams", "google_chat", "wecom", "dingtalk", "simplex", "photon", "buzz", "ntfy"]);
const TARGET = /^[A-Za-z0-9_@.!+#-]{1,128}$/;
export interface MessengerDraft { accountId: "default"; platform: string; recipient: string; text: string }
export interface MessengerReceipt { receiptId: string; accountId: string; platform: string; recipient: string;
  state: "pending" | "sent" | "uncertain"; externalId: string | null; createdAt: string; replayed: boolean }
type RunnerResult = { state?: string; externalId?: string | null; reason?: string };

function validate(draft: MessengerDraft): void {
  if (!draft || draft.accountId !== "default" || !PLATFORM.has(draft.platform) || !TARGET.test(draft.recipient) ||
      typeof draft.text !== "string" || !draft.text.trim() || Buffer.byteLength(draft.text, "utf8") > 8192 ||
      draft.text.includes("MEDIA:") || draft.text.includes("[[as_document]]")) {
    throw validationFailed("Kanal, exakter Empfänger oder Nachricht ist ungültig.");
  }
}

export class MessengerSendService {
  constructor(private readonly db: Db, private readonly dataDir: string, private readonly approvals: ApprovalTokenService,
    private readonly invoke: RunnerInvoker = invokeCodingRunner) {}

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

  private fingerprint(actor: string, draft: MessengerDraft): string {
    return sha(JSON.stringify([actor, draft.accountId, draft.platform, draft.recipient, draft.text]));
  }

  async preview(actor: string, draft: MessengerDraft): Promise<{ token: string; expiresAt: string; fingerprint: string;
    draft: MessengerDraft }> {
    validate(draft);
    const ready = await this.run("check", draft);
    if (ready.state !== "ready") throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Empfänger oder Hermes-Kanal ist nicht eingerichtet." });
    const fingerprint = this.fingerprint(actor, draft);
    const { token, claims } = this.approvals.issue({ approvalId: fingerprint, userId: actor, action: "messenger.send" });
    return { token, expiresAt: new Date(claims.expiresAt).toISOString(), fingerprint, draft };
  }

  async confirm(actor: string, draft: MessengerDraft, token: string, key: string): Promise<MessengerReceipt> {
    validate(draft);
    if (typeof token !== "string" || !key || key.length < 8 || key.length > 128) throw validationFailed("Freigabe oder Idempotency-Key fehlt.");
    const keyHash = sha(JSON.stringify([actor, draft.accountId, key]));
    const payloadHash = this.fingerprint(actor, draft);
    const existing = this.lookup(keyHash);
    if (existing) return this.replay(keyHash, existing, payloadHash);
    const ready = await this.run("check", draft);
    if (ready.state !== "ready") throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Empfänger oder Hermes-Kanal ist nicht eingerichtet." });
    const valid = this.approvals.consume(token, { approvalId: payloadHash, userId: actor, action: "messenger.send" });
    if (!valid.ok) throw conflict("Nachricht oder Empfänger wurde geändert; bitte neu freigeben.");
    const now = new Date().toISOString();
    const inserted = this.db.prepare(`INSERT OR IGNORE INTO messenger_send_journal
      (key_hash,actor,account_id,platform,recipient,payload_hash,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'pending',?,?)`).run(keyHash, actor, draft.accountId, draft.platform, draft.recipient,
      payloadHash, now, now).changes;
    if (!inserted) return this.replay(keyHash, this.lookup(keyHash)!, payloadHash);
    const result = await this.run("send", draft);
    const state = result.state === "sent" ? "sent" : "uncertain";
    this.db.prepare("UPDATE messenger_send_journal SET state=?,external_id=?,updated_at=? WHERE key_hash=?")
      .run(state, state === "sent" && typeof result.externalId === "string" ? result.externalId : null,
        new Date().toISOString(), keyHash);
    return this.replay(keyHash, this.lookup(keyHash)!, payloadHash, false);
  }

  receipts(actor: string): MessengerReceipt[] {
    const rows = this.db.prepare(`SELECT key_hash,account_id,platform,recipient,payload_hash,state,external_id,created_at
      FROM messenger_send_journal WHERE actor=? ORDER BY created_at DESC LIMIT 50`).all(actor) as unknown as Array<JournalRow & { key_hash: string }>;
    return rows.map((row) => this.public(row.key_hash, row, false));
  }

  private lookup(keyHash: string): JournalRow | undefined {
    return this.db.prepare(`SELECT account_id,platform,recipient,payload_hash,state,external_id,created_at
      FROM messenger_send_journal WHERE key_hash=?`).get(keyHash) as JournalRow | undefined;
  }

  private replay(keyHash: string, row: JournalRow, payloadHash: string, replayed = true): MessengerReceipt {
    if (row.payload_hash !== payloadHash) throw conflict("Idempotency-Key wurde für eine andere Nachricht verwendet.");
    return this.public(keyHash, row, replayed);
  }

  private public(keyHash: string, row: JournalRow, replayed: boolean): MessengerReceipt {
    return { receiptId: keyHash, accountId: row.account_id, platform: row.platform, recipient: row.recipient,
      state: row.state, externalId: row.external_id, createdAt: row.created_at, replayed };
  }
}

interface JournalRow { account_id: string; platform: string; recipient: string; payload_hash: string;
  state: "pending" | "sent" | "uncertain"; external_id: string | null; created_at: string }
