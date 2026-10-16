import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";

export interface HimalayaAccountStatus {
  managed: boolean;
  configPresent: boolean;
  credentialsPresent: boolean;
  cliInstalled: boolean;
  readyForLocalUse: boolean;
  connectionChecked: boolean;
  revision: number;
}

export interface HimalayaAccountPatch {
  email: string; displayName: string;
  imapHost: string; imapPort: number; imapLogin: string; imapPassword: string;
  smtpHost: string; smtpPort: number; smtpLogin: string; smtpPassword: string;
  smtpEncryption: "tls" | "start-tls";
  sentFolder: string; draftsFolder: string; trashFolder: string;
}

const unavailable = () => new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Himalaya-Einrichtung in Friday-Ubuntu ist nicht erreichbar." });

export class HimalayaAccountService {
  constructor(private readonly dataDir: string, private readonly invoke: RunnerInvoker = invokeCodingRunner) {}

  private target(): { script: string; distro: string; user: string } {
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
      script: `/mnt/${match[1]?.toLowerCase()}/${match[2]?.replaceAll("\\", "/")}/installer/wsl/configure_himalaya.py` };
  }

  private async run(action: "status" | "update", input?: HimalayaAccountPatch & { revision: number }): Promise<HimalayaAccountStatus> {
    const { script, distro, user } = this.target();
    let data: Record<string, unknown>;
    try { data = await this.invoke(script, distro, user, [action], input ? JSON.stringify(input) : undefined, 20000); }
    catch (error) {
      const message = String(error);
      if (message.includes("runner_3:")) throw conflict("Das Postfach wurde inzwischen geaendert. Bitte neu laden.");
      if (message.includes("runner_4:")) throw validationFailed("Ungueltiges IMAP/SMTP-Profil.");
      if (message.includes("runner_6:")) throw conflict("Eine bestehende Himalaya-Konfiguration gehoert nicht Friday und wird nicht ueberschrieben.");
      throw unavailable();
    }
    if (!["managed", "configPresent", "credentialsPresent", "cliInstalled", "readyForLocalUse", "connectionChecked"].every((key) => typeof data[key] === "boolean") ||
        !Number.isSafeInteger(data.revision)) throw unavailable();
    return data as unknown as HimalayaAccountStatus;
  }

  status(): Promise<HimalayaAccountStatus> { return this.run("status"); }

  async checkSmtp(): Promise<{ ok: boolean }> {
    const { script, distro, user } = this.target();
    let result: Record<string, unknown>;
    try { result = await this.invoke(script, distro, user, ["check-smtp"], undefined, 18000); }
    catch { throw unavailable(); }
    if (typeof result.ok !== "boolean") throw unavailable();
    return { ok: result.ok };
  }

  update(input: HimalayaAccountPatch, revision: number): Promise<HimalayaAccountStatus> {
    if (!Number.isSafeInteger(revision) || !input || typeof input !== "object") throw validationFailed("Ungueltiges IMAP/SMTP-Profil.");
    return this.run("update", { ...input, revision });
  }

  private async read(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const state = await this.status();
    if (!state.readyForLocalUse) throw unavailable();
    const { script, distro, user } = this.target();
    const readScript = script.replace(/configure_himalaya\.py$/, "read_himalaya.py");
    if (readScript === script) throw unavailable();
    try { return await this.invoke(readScript, distro, user, [], JSON.stringify(request), 20000, 512000); }
    catch (error) {
      if (String(error).includes("runner_4:")) throw validationFailed("Ungueltige Postfach-Auswahl.");
      throw unavailable();
    }
  }

  async mailboxes(): Promise<{ mailboxes: Array<{ id: string; name: string; role: string | null }> }> {
    const result = await this.read({ action: "mailboxes" });
    if (!Array.isArray(result.mailboxes) || !result.mailboxes.every((row) => row && typeof row === "object" &&
      typeof row.id === "string" && typeof row.name === "string" && (row.role === null || typeof row.role === "string"))) throw unavailable();
    return result as { mailboxes: Array<{ id: string; name: string; role: string | null }> };
  }

  async envelopes(mailbox: string, page: number): Promise<Record<string, unknown>> {
    if (!mailbox || mailbox.length > 200 || !Number.isSafeInteger(page) || page < 1 || page > 20) throw validationFailed("Ungueltige Postfach-Auswahl.");
    const result = await this.read({ action: "envelopes", mailbox, page });
    if (!Array.isArray(result.items) || result.mailbox !== mailbox || result.page !== page) throw unavailable();
    return result;
  }

  async message(mailbox: string, id: string): Promise<Record<string, unknown>> {
    if (!mailbox || mailbox.length > 200 || !/^[1-9][0-9]{0,17}$/.test(id)) throw validationFailed("Ungueltige Nachricht.");
    const result = await this.read({ action: "message", mailbox, id });
    if (result.mailbox !== mailbox || result.id !== id || typeof result.bodyText !== "string") throw unavailable();
    return result;
  }

  async sendRaw(input: { to: string[]; subject: string; body: string }): Promise<void> {
    const { script, distro, user } = this.target();
    const sendScript = script.replace(/configure_himalaya\.py$/, "send_himalaya.py");
    if (sendScript === script) throw unavailable();
    const result = await this.invoke(sendScript, distro, user, [], JSON.stringify(input), 30000);
    if (result.state !== "sent") throw unavailable();
  }
}
