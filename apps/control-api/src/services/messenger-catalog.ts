import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiError } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";

const OFFERED = new Set(["telegram", "discord", "whatsapp", "whatsapp_cloud", "slack", "signal", "mattermost",
  "matrix", "sms", "dingtalk", "feishu", "wecom", "weixin", "bluebubbles", "qqbot", "yuanbao", "teams",
  "buzz", "google_chat", "irc", "line", "ntfy", "photon", "simplex"]);
const SEND_EXACT = new Set(["telegram", "discord", "whatsapp", "slack", "signal", "matrix", "mattermost", "sms",
  "irc", "line", "feishu", "wecom", "photon", "buzz", "ntfy", "teams", "google_chat", "simplex", "weixin", "bluebubbles",
  "dingtalk", "whatsapp_cloud", "qqbot"]);
const NATIVE_SETUP = new Set(["telegram", "discord", "whatsapp"]);
export interface MessengerCatalogField { name: string; secret: boolean; required: boolean; present: boolean }
export interface MessengerCatalogItem { platform: string; source: "bundled_plugin" | "builtin";
  fields: MessengerCatalogField[]; configured: boolean; gatewayRunning: boolean;
  connectionState: "connected" | "disconnected" | "unknown"; exactSendSupported: boolean; nativeSetupAvailable: boolean }
export interface MessengerCatalog { pin: string; items: MessengerCatalogItem[] }

const unavailable = () => new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Hermes-Messenger-Inventar ist nicht erreichbar." });

export class MessengerCatalogService {
  constructor(private readonly dataDir: string, private readonly invoke: RunnerInvoker = invokeCodingRunner) {}

  async list(): Promise<MessengerCatalog> {
    let root = resolve(this.dataDir);
    for (let depth = 0; depth < 5 && !existsSync(join(root, "config", "install-state.json")); depth += 1) root = resolve(root, "..");
    let state: { distro_name?: string; linux_user?: string };
    try { state = JSON.parse(readFileSync(join(root, "config", "install-state.json"), "utf8").replace(/^\uFEFF/, "")) as typeof state; }
    catch { throw unavailable(); }
    const match = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!match || !state.distro_name || !/^[A-Za-z0-9_.-]+$/.test(state.distro_name) ||
        !state.linux_user || !/^[A-Za-z0-9_-]+$/.test(state.linux_user)) throw unavailable();
    const script = `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replaceAll("\\", "/")}/installer/wsl/messaging_catalog.py`;
    let result: Record<string, unknown>;
    try { result = await this.invoke(script, state.distro_name, state.linux_user, [], undefined, 30000); }
    catch { throw unavailable(); }
    if (result.state !== "available" || result.pin !== "d923a5eb" || !Array.isArray(result.items) || result.items.length !== OFFERED.size)
      throw unavailable();
    const seen = new Set<string>();
    const items = result.items.map((raw) => {
      const item = raw as Record<string, unknown>;
      if (typeof item.platform !== "string" || !OFFERED.has(item.platform) || seen.has(item.platform) ||
          !["bundled_plugin", "builtin"].includes(String(item.source)) || !Array.isArray(item.fields) ||
          typeof item.configured !== "boolean" || typeof item.gatewayRunning !== "boolean" ||
          !["connected", "disconnected", "unknown"].includes(String(item.connectionState))) throw unavailable();
      seen.add(item.platform);
      const fields = item.fields.map((fieldRaw) => {
        const field = fieldRaw as Record<string, unknown>;
        if (typeof field.name !== "string" || !/^[A-Z][A-Z0-9_]{2,80}$/.test(field.name) ||
            typeof field.secret !== "boolean" || typeof field.required !== "boolean" || typeof field.present !== "boolean") throw unavailable();
        return { name: field.name, secret: field.secret, required: field.required,
          present: field.present } as MessengerCatalogField;
      });
      return { platform: item.platform, source: item.source as MessengerCatalogItem["source"], fields,
        configured: item.configured, gatewayRunning: item.gatewayRunning,
        connectionState: item.connectionState as MessengerCatalogItem["connectionState"],
        exactSendSupported: SEND_EXACT.has(item.platform), nativeSetupAvailable: NATIVE_SETUP.has(item.platform) };
    });
    return { pin: result.pin, items };
  }
}
