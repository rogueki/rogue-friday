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
    try { state = JSON.parse(readFileSync(join(root, "config", "install-state.json"), "utf8")) as typeof state; }
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

  update(input: HimalayaAccountPatch, revision: number): Promise<HimalayaAccountStatus> {
    if (!Number.isSafeInteger(revision) || !input || typeof input !== "object") throw validationFailed("Ungueltiges IMAP/SMTP-Profil.");
    return this.run("update", { ...input, revision });
  }
}
