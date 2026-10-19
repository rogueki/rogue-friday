import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";
import { MessengerCatalogService } from "./messenger-catalog";

const PROVIDERS = new Set(["bluebubbles", "buzz", "dingtalk", "feishu", "google_chat", "irc", "line", "matrix",
  "mattermost", "ntfy", "photon", "qqbot", "signal", "simplex", "slack", "sms", "teams", "wecom", "weixin",
  "whatsapp_cloud", "yuanbao"]);
export type ProviderState = { state: "available" | "saved" | "partial" | "uncertain" | "applied"; platform: string;
  revision: string; gatewayRestarted?: boolean; connectionState?: "connected" | "disconnected" | "unknown" };
const unavailable = () => new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Hermes-Provider-Konfiguration ist nicht erreichbar." });

export class MessengerProviderService {
  constructor(private readonly dataDir: string, private readonly catalog: MessengerCatalogService,
    private readonly invoke: RunnerInvoker = invokeCodingRunner) {}

  private target() {
    let root = resolve(this.dataDir);
    for (let depth = 0; depth < 5 && !existsSync(join(root, "config", "install-state.json")); depth += 1) root = resolve(root, "..");
    let state: { distro_name?: string; linux_user?: string };
    try { state = JSON.parse(readFileSync(join(root, "config", "install-state.json"), "utf8").replace(/^\uFEFF/, "")) as typeof state; }
    catch { throw unavailable(); }
    const match = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!match || !state.distro_name || !/^[A-Za-z0-9_.-]+$/.test(state.distro_name) ||
        !state.linux_user || !/^[A-Za-z0-9_-]+$/.test(state.linux_user)) throw unavailable();
    return { script: `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replaceAll("\\", "/")}/installer/wsl/configure_messaging_provider.py`,
      distro: state.distro_name, user: state.linux_user };
  }

  private async run(platform: string, action: "status" | "update" | "apply", request?: { revision: string; values?: Record<string, string | null> }): Promise<ProviderState> {
    if (!PROVIDERS.has(platform)) throw validationFailed("Unbekannter Hermes-Nachrichtenkanal.");
    const target = this.target();
    let data: Record<string, unknown>;
    try { data = await this.invoke(target.script, target.distro, target.user, [platform, action],
      request ? JSON.stringify(request) : undefined, 35000); }
    catch { throw unavailable(); }
    if (data.state === "conflict") throw conflict("Provider-Konfiguration wurde inzwischen geändert. Bitte neu laden.");
    if (data.state === "rejected") throw validationFailed("Ungültiges Provider-Feld oder ungültiger Wert.");
    if (data.state === "unavailable") throw unavailable();
    if (!["available", "saved", "partial", "uncertain", "applied"].includes(String(data.state)) || data.platform !== platform ||
        typeof data.revision !== "string" || !/^[a-f0-9]{64}$/.test(data.revision)) throw unavailable();
    if (action === "status" && data.state !== "available" || action === "update" && !["saved", "partial", "uncertain"].includes(String(data.state))) throw unavailable();
    if (action === "apply" && !["applied", "uncertain"].includes(String(data.state))) throw unavailable();
    if (action === "apply" && !["connected", "disconnected", "unknown"].includes(String(data.connectionState))) throw unavailable();
    return { state: data.state as ProviderState["state"], platform, revision: data.revision,
      ...(["saved", "applied", "uncertain"].includes(String(data.state)) && typeof data.gatewayRestarted === "boolean" ?
        { gatewayRestarted: data.gatewayRestarted } : {}),
      ...(action === "apply" ? { connectionState: data.connectionState as ProviderState["connectionState"] } : {}) };
  }

  status(platform: string): Promise<ProviderState> { return this.run(platform, "status"); }

  apply(platform: string, revision: string): Promise<ProviderState> {
    if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) throw validationFailed("Provider-Revision ist ungültig.");
    return this.run(platform, "apply", { revision });
  }

  async update(platform: string, input: { revision: string; values: Record<string, string | null> }): Promise<ProviderState> {
    if (!PROVIDERS.has(platform)) throw validationFailed("Unbekannter Hermes-Nachrichtenkanal.");
    const item = (await this.catalog.list()).items.find((entry) => entry.platform === platform);
    if (!item) throw unavailable();
    const allowed = new Set(item.fields.map((field) => field.name));
    if (!input || typeof input !== "object" || !/^[a-f0-9]{64}$/.test(String(input.revision)) ||
        !input.values || typeof input.values !== "object" || Array.isArray(input.values) ||
        Object.keys(input.values).length < 1 || Object.keys(input.values).length > 10 ||
        Object.entries(input.values).some(([key, value]) => !allowed.has(key) ||
          value !== null && (typeof value !== "string" || !value || value.length > (key === "GOOGLE_CHAT_SERVICE_ACCOUNT_JSON" ? 32768 : 4096))))
      throw validationFailed("Provider-Felder oder Revision sind ungültig.");
    return this.run(platform, "update", input);
  }
}
