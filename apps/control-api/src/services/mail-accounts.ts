import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { codingRunnerCommand, type RunnerInvoker } from "./coding-runs";

export interface MailAccount {
  id: string; displayName: string; email: string; senderName: string; aliases: string[]; signature: string;
  imapHost: string; imapPort: number; imapSecurity: "tls" | "start-tls"; imapLogin: string;
  smtpHost: string; smtpPort: number; smtpSecurity: "tls" | "start-tls"; smtpLogin: string;
  sentFolder: string; draftsFolder: string; trashFolder: string; archiveFolder: string; spamFolder: string;
  authMode: "password" | "google-oauth" | "microsoft-oauth"; oauthClientId: string; oauthTenant: string;
  revision: number; secretState: { imapPassword: boolean; smtpPassword: boolean; oauthRefreshToken: boolean };
}
export type MailAccountInput = Omit<MailAccount, "id" | "revision" | "secretState" | "authMode" | "oauthClientId" | "oauthTenant"> &
  Partial<Pick<MailAccount, "authMode" | "oauthClientId" | "oauthTenant">> & { id?: string };
export type MailSecrets = { imapPassword?: string | null; smtpPassword?: string | null };

const unavailable = () => new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Mail Postfach in Friday-Ubuntu ist nicht erreichbar." });

const invokeMailRunner: RunnerInvoker = (script, distro, user, args, input, timeoutMs = 20_000, maxOutputBytes = 512_000) => {
  const maxInputBytes = 8_000_000;
  if (Buffer.byteLength(input ?? "", "utf8") > maxInputBytes || timeoutMs > 35_000 || maxOutputBytes > 8_000_000)
    throw validationFailed("Mailinhalt oder Anhang überschreitet das Limit.");
  return new Promise((resolveResult, reject) => {
    const command = codingRunnerCommand(script, distro, user, args);
    const child = spawn(command.file, command.args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > maxOutputBytes) child.kill();
    });
    // Provider/CLI stderr can include mailbox data; do not capture or forward it.
    child.stderr.resume();
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let parsed: unknown;
      try { parsed = JSON.parse(stdout.trim()); } catch { parsed = null; }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reject(new Error("mail_runner_invalid"));
      if (code !== 0) return reject(new Error("mail_runner_" + code + ":" + String((parsed as { error?: string }).error ?? "unknown")));
      resolveResult(parsed as Record<string, unknown>);
    });
    child.stdin.on("error", reject);
    child.stdin.end(input ?? "");
  });
};

export class MailAccountsService {
  constructor(private readonly dataDir: string, private readonly invoke: RunnerInvoker = invokeMailRunner) {}

  // Protected so tests can pin the WSL target: the real resolution needs a Windows install path.
  protected target(): { script: string; distro: string; user: string } {
    let root = resolve(this.dataDir);
    for (let depth = 0; depth < 5 && !existsSync(join(root, "config", "install-state.json")); depth += 1) root = resolve(root, "..");
    if (!existsSync(join(root, "config", "install-state.json"))) throw unavailable();
    let state: { distro_name?: string; linux_user?: string };
    try { state = JSON.parse(readFileSync(join(root, "config", "install-state.json"), "utf8").replace(/^\uFEFF/, "")) as typeof state; }
    catch { throw unavailable(); }
    if (!state.distro_name || !state.linux_user || !/^[a-zA-Z0-9_.-]+$/.test(state.distro_name) || !/^[a-zA-Z0-9_-]+$/.test(state.linux_user)) throw unavailable();
    const match = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!match) throw unavailable();
    return { distro: state.distro_name, user: state.linux_user,
      script: `/mnt/${match[1]?.toLowerCase()}/${match[2]?.replaceAll("\\", "/")}/installer/wsl/mail_accounts.py` };
  }

  async run<T>(request: Record<string, unknown>, timeoutMs = 20_000, maxOutputBytes = 512_000): Promise<T> {
    const { script, distro, user } = this.target();
    let result: Record<string, unknown>;
    try { result = await this.invoke(script, distro, user, [], JSON.stringify(request), timeoutMs, maxOutputBytes); }
    catch (error) {
      const message = String(error);
      if (message.includes("revision_conflict") || message.includes("runner_3:")) throw conflict("Das Mail Postfach wurde inzwischen geändert. Bitte neu laden.");
      if (message.includes("uidvalidity_conflict")) throw conflict("Der Ordner wurde neu aufgebaut. Bitte Nachrichten neu laden.");
      if (message.includes("account_not_found")) throw validationFailed("Mail Postfach existiert nicht.");
      if (message.includes("oauthRefreshToken_missing")) throw validationFailed("OAuth-Autorisierung fehlt. Konto verbinden.");
      if (message.includes("oauth_refresh_failed")) throw validationFailed("OAuth-Token konnte nicht erneuert werden. Konto erneut verbinden.");
      if (message.includes("oauth_scope_missing")) throw validationFailed("OAuth-Berechtigung für IMAP und SMTP fehlt. Konto erneut verbinden.");
      if (message.includes("invalid_sender")) throw validationFailed("Der Absender gehört nicht zu diesem Konto.",
        [{ path: "from", message: "Konto-Adresse oder einen hinterlegten Alias wählen" }]);
      if (message.includes("invalid_recipients")) throw validationFailed("Empfängeradresse fehlt oder ist ungültig.",
        [{ path: "to", message: "Mindestens einen gültigen Empfänger angeben" }]);
      if (message.includes("invalid_")) throw validationFailed("Die Verbindungsdaten sind unvollständig oder ungültig.",
        [{ path: "account", message: "Host, Port, Verschlüsselung und Anmeldung prüfen" }]);
      throw unavailable();
    }
    if (result.error) {
      if (result.error === "revision_conflict") throw conflict("Das Mail Postfach wurde inzwischen geändert. Bitte neu laden.");
      if (result.error === "uidvalidity_conflict") throw conflict("Der Ordner wurde neu aufgebaut. Bitte Nachrichten neu laden.");
      if (result.error === "oauthRefreshToken_missing") throw validationFailed("OAuth-Autorisierung fehlt. Konto verbinden.");
      if (result.error === "oauth_refresh_failed") throw validationFailed("OAuth-Token konnte nicht erneuert werden. Konto erneut verbinden.");
      if (result.error === "oauth_scope_missing") throw validationFailed("OAuth-Berechtigung für IMAP und SMTP fehlt. Konto erneut verbinden.");
      if (result.error === "invalid_sender") throw validationFailed("Der Absender gehört nicht zu diesem Konto.",
        [{ path: "from", message: "Konto-Adresse oder einen hinterlegten Alias wählen" }]);
      if (result.error === "invalid_recipients") throw validationFailed("Empfängeradresse fehlt oder ist ungültig.",
        [{ path: "to", message: "Mindestens einen gültigen Empfänger angeben" }]);
      throw unavailable();
    }
    return result as T;
  }

  list() { return this.run<{ revision: number; defaultAccountId: string | null; accounts: MailAccount[] }>({ action: "list" }); }
  upsert(account: MailAccountInput, secrets: MailSecrets, expectedRevision: number | null) {
    return this.run<MailAccount>({ action: "upsert", account, secrets, expectedRevision });
  }
  remove(accountId: string, expectedRevision: number) {
    return this.run<{ deleted: boolean }>({ action: "delete", accountId, expectedRevision });
  }
  setDefault(accountId: string, expectedRevision: number) {
    return this.run<{ revision: number; defaultAccountId: string }>({ action: "default", accountId, expectedRevision });
  }
  /** Tests an unsaved draft without storing it; the bridge decides once and returns a stable reason. */
  checkCandidate(account: MailAccountInput, protocol: "imap" | "smtp", password: string) {
    return this.run<{ ok: boolean; reason: "ok" | "auth" | "tls" | "network" | "protocol" }>(
      { action: "check-candidate", protocol, account, secrets: { password } });
  }
  check(accountId: string, protocol: "imap" | "smtp") {
    return this.run<{ ok: boolean; folders?: Array<{ id: string; name: string; role: string | null }> }>({ action: `check-${protocol}`, accountId });
  }
  folders(accountId: string) {
    return this.run<{ folders: Array<{ id: string; name: string; role: string | null }> }>({ action: "folders", accountId });
  }
  envelopes(accountId: string, mailbox: string, page: number) {
    return this.run<{ mailbox: string; uidValidity: string | null; page: number; items: unknown[] }>({ action: "envelopes", accountId, mailbox, page });
  }
  search(accountId: string, mailbox: string, query: string, page: number) {
    return this.run<{ mailbox: string; uidValidity: string | null; page: number; items: unknown[] }>(
      { action: "search", accountId, mailbox, query, page });
  }
  message(accountId: string, mailbox: string, uid: string, uidValidity: string) {
    return this.run<Record<string, unknown>>({ action: "message", accountId, mailbox, uid, uidValidity });
  }
  attachment(accountId: string, mailbox: string, uid: string, uidValidity: string, index: number) {
    return this.run<{ filename: string; contentType: string; size: number; data: string }>(
      { action: "attachment", accountId, mailbox, uid, uidValidity, index }, 20_000, 8_000_000);
  }
  change(accountId: string, mailbox: string, uid: string, uidValidity: string, kind: "move" | "flag", destination?: string) {
    return this.run<{ changed: boolean }>({ action: "change", accountId, mailbox, uid, uidValidity, kind, destination });
  }
  send(accountId: string, message: Record<string, unknown>) {
    return this.run<{ state: "sent" | "uncertain"; archivePending: boolean }>({ action: "send", accountId, message }, 35_000);
  }
  draft(accountId: string, message: Record<string, unknown>) {
    return this.run<{ state: "drafted"; messageId: string; alreadyPresent: boolean }>({ action: "draft", accountId, message }, 20_000);
  }
  archive(accountId: string, message: Record<string, unknown>) {
    return this.run<{ state: "archived"; alreadyPresent: boolean }>({ action: "archive", accountId, message }, 35_000);
  }
  probeSent(accountId: string, messageId: string) {
    return this.run<{ present: boolean }>({ action: "probe", accountId, messageId });
  }
  completeOAuth(accountId: string, expectedRevision: number, refreshToken: string, scopes: string[]) {
    return this.run<MailAccount>({ action: "oauth-complete", accountId, expectedRevision, refreshToken, scopes });
  }
  revokeOAuth(accountId: string, expectedRevision: number) {
    return this.run<MailAccount>({ action: "oauth-revoke", accountId, expectedRevision });
  }
}
