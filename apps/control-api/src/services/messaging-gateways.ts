import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";

export type MessagingPlatform = "discord" | "whatsapp";
export interface MessagingGatewayStatus {
  setupUrl: string;
  allowedUserIds: string[];
  enabled: boolean | null;
  gatewayRunning: boolean | null;
  connectionState: "connected" | "disconnected" | "unknown";
  applied: boolean | null;
  revision: number;
  tokenConfigured?: boolean;
  allowedChannelIds?: string[];
  mode?: "bot" | "self-chat" | null;
  sessionPresent?: boolean;
  groupPolicy?: "open" | "allowlist" | "disabled" | "pairing" | null;
  groupAllowedIds?: string[];
  requireMention?: boolean | null;
  replyPrefix?: string | null;
}
export type MessagingGatewayPatch = {
  allowedUserIds: string[]; enabled: boolean;
} & ({ token: string; clearToken: boolean; allowedChannelIds: string[] } | {
  mode: "bot" | "self-chat"; groupPolicy: "disabled" | "allowlist"; groupAllowedIds: string[]; requireMention: boolean; replyPrefix: string;
});
export interface WhatsappPairing {
  id: string | null;
  state: "idle" | "starting" | "waiting" | "qr_expired" | "connected" | "unverified" | "expired" | "cancelled" | "error";
  mode?: "bot" | "self-chat";
  qr: string | null;
  expiresAt: number | null;
  linkedIdentity: string | null;
  connectionState: "connected" | "disconnected" | "unknown";
}

const unavailable = () => new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Hermes-Nachrichten-Gateway in Friday-Ubuntu ist nicht erreichbar." });
const SNOWFLAKE = /^[1-9][0-9]{0,19}$/;
const PHONE = /^[1-9][0-9]{5,19}$/;
const TOKEN = /^[A-Za-z0-9_.-]{30,128}$/;
const GROUP_JID = /^[0-9]{6,40}(-[0-9]{6,20})?@g\.us$/;
const REPLY_PREFIX = /^[^\r\n"\\$`]{0,40}$/;
const idsValid = (ids: unknown, pattern: RegExp, limit: number): ids is string[] => Array.isArray(ids) && ids.length <= limit &&
  ids.every((id) => typeof id === "string" && pattern.test(id)) && new Set(ids).size === ids.length;

export class MessagingGatewayService {
  constructor(private readonly dataDir: string, readonly platform: MessagingPlatform,
    private readonly invoke: RunnerInvoker = invokeCodingRunner) {}

  private target(): { script: string; distro: string; user: string; setupUrl: string } {
    let root = resolve(this.dataDir);
    for (let depth = 0; depth < 5 && !existsSync(join(root, "config", "install-state.json")); depth += 1) root = resolve(root, "..");
    let state: { distro_name?: string; linux_user?: string; ports?: { Dashboard?: number } };
    try { state = JSON.parse(readFileSync(join(root, "config", "install-state.json"), "utf8").replace(/^\uFEFF/, "")) as typeof state; }
    catch { throw unavailable(); }
    if (!state.distro_name || !state.linux_user || !/^[a-zA-Z0-9_.-]+$/.test(state.distro_name) || !/^[a-zA-Z0-9_-]+$/.test(state.linux_user)) throw unavailable();
    const match = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!match) throw unavailable();
    const port = state.ports?.Dashboard;
    return { distro: state.distro_name, user: state.linux_user,
      setupUrl: `http://127.0.0.1:${Number.isSafeInteger(port) && port! > 0 && port! <= 65535 ? port : 43791}/channels`,
      script: `/mnt/${match[1]?.toLowerCase()}/${match[2]?.replaceAll("\\", "/")}/installer/wsl/configure_messaging_gateway.py` };
  }

  private async run(action: "status" | "update", input?: MessagingGatewayPatch & { revision: number }): Promise<MessagingGatewayStatus> {
    const { script, distro, user, setupUrl } = this.target();
    let data: Record<string, unknown>;
    try { data = await this.invoke(script, distro, user, [this.platform, action], input ? JSON.stringify(input) : undefined, action === "update" ? 50000 : 20000); }
    catch (error) {
      if (action === "update" && error instanceof Error && error.message.startsWith("runner_3:")) throw conflict("Die Gateway-Konfiguration wurde inzwischen geändert. Bitte neu laden.");
      if (action === "update" && error instanceof Error && error.message.startsWith("runner_4:bot_token_rejected"))
        throw validationFailed("Discord hat das neue Bot-Token abgelehnt. Das bisher gespeicherte Token bleibt unverändert.");
      if (action === "update" && error instanceof Error && error.message.startsWith("runner_4:bot_unverified"))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
          message: "Discord war nicht erreichbar, das Bot-Token konnte nicht geprüft werden. Es wurde nichts geändert." });
      if (action === "update" && error instanceof Error && error.message.startsWith("runner_4:")) throw validationFailed("Zum Aktivieren fehlen Bot-Token oder QR-Kopplung und erlaubte Nutzer.");
      throw unavailable();
    }
    if (!idsValid(data.allowedUserIds, this.platform === "discord" ? SNOWFLAKE : PHONE, 10) ||
        !(data.enabled === null || typeof data.enabled === "boolean") ||
        !(data.gatewayRunning === null || typeof data.gatewayRunning === "boolean") ||
        !["connected", "disconnected", "unknown"].includes(String(data.connectionState)) || !(data.applied === null || typeof data.applied === "boolean") ||
        !Number.isSafeInteger(data.revision)) throw unavailable();
    if (this.platform === "discord" && (typeof data.tokenConfigured !== "boolean" || !idsValid(data.allowedChannelIds, SNOWFLAKE, 20))) throw unavailable();
    if (this.platform === "whatsapp" && (typeof data.sessionPresent !== "boolean" || ![null, "bot", "self-chat"].includes(data.mode as string | null) ||
        ![null, "open", "allowlist", "disabled", "pairing"].includes(data.groupPolicy as string | null) ||
        !Array.isArray(data.groupAllowedIds) || data.groupAllowedIds.length > 50 ||
        !data.groupAllowedIds.every((id) => typeof id === "string" && id.length <= 128) ||
        !(data.requireMention === null || typeof data.requireMention === "boolean") ||
        !(data.replyPrefix === null || typeof data.replyPrefix === "string" && data.replyPrefix.length <= 256))) throw unavailable();
    return { ...data, setupUrl } as MessagingGatewayStatus;
  }

  status(): Promise<MessagingGatewayStatus> { return this.run("status"); }

  update(input: MessagingGatewayPatch, revision: number): Promise<MessagingGatewayStatus> {
    if (!Number.isSafeInteger(revision) || typeof input.enabled !== "boolean" ||
        !idsValid(input.allowedUserIds, this.platform === "discord" ? SNOWFLAKE : PHONE, 10)) throw validationFailed("Erlaubte Nutzer-IDs sind ungültig.");
    if (this.platform === "discord") {
      const patch = input as Extract<MessagingGatewayPatch, { token: string }>;
      if (typeof patch.token !== "string" || (patch.token !== "" && !TOKEN.test(patch.token)) ||
          typeof patch.clearToken !== "boolean" || (patch.clearToken && !!patch.token) ||
          !idsValid(patch.allowedChannelIds, SNOWFLAKE, 20)) throw validationFailed("Discord-Bot-Token oder Kanal-IDs sind ungültig.");
    } else {
      const patch = input as Extract<MessagingGatewayPatch, { mode: string }>;
      if (!(["bot", "self-chat"] as unknown[]).includes(patch.mode)) throw validationFailed("WhatsApp-Modus ist ungültig.");
      // Friday never opens every group; "open" stays a Hermes-only choice.
      if (!(["disabled", "allowlist"] as unknown[]).includes(patch.groupPolicy) || !idsValid(patch.groupAllowedIds, GROUP_JID, 20) ||
          typeof patch.requireMention !== "boolean") throw validationFailed("WhatsApp-Gruppenregeln sind ungültig.");
      if (typeof patch.replyPrefix !== "string" || !REPLY_PREFIX.test(patch.replyPrefix))
        throw validationFailed("Die Antwort-Kopfzeile darf höchstens 40 Zeichen ohne Zeilenumbruch, Anführungszeichen, \\, $ oder ` enthalten.");
    }
    return this.run("update", { ...input, revision });
  }

  async pairing(action: "status" | "start" | "refresh" | "cancel" | "logout" | "reconnect", mode?: "bot" | "self-chat"): Promise<WhatsappPairing> {
    if (this.platform !== "whatsapp" || ((action === "start" || action === "refresh") && mode !== "bot" && mode !== "self-chat")) {
      throw validationFailed("WhatsApp-Kopplung ist ungültig.");
    }
    const { script: configScript, distro, user } = this.target();
    const script = configScript.replace(/configure_messaging_gateway\.py$/, "messaging_pairing.py");
    let data: Record<string, unknown>;
    try { data = await this.invoke(script, distro, user, [action, ...(mode ? [mode] : [])], undefined, 10000); }
    catch (error) {
      if ((action === "start" || action === "refresh") && error instanceof Error && error.message.startsWith("runner_4:"))
        throw conflict("WhatsApp ist bereits gekoppelt oder verbunden. Zum Neukoppeln zuerst abmelden.");
      if (action === "reconnect" && error instanceof Error && error.message.startsWith("runner_4:"))
        throw conflict("Es gibt keine gekoppelte WhatsApp-Sitzung, die neu verbunden werden kann.");
      throw unavailable();
    }
    const states = ["idle", "starting", "waiting", "qr_expired", "connected", "unverified", "expired", "cancelled", "error"];
    if (!states.includes(String(data.state)) ||
      !(data.id === null || typeof data.id === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(data.id)) ||
      !(data.qr === null || typeof data.qr === "string" && data.qr.length <= 4096) ||
      !(data.expiresAt === null || typeof data.expiresAt === "number" && Number.isFinite(data.expiresAt)) ||
      !(data.linkedIdentity === null || typeof data.linkedIdentity === "string" && data.linkedIdentity.length <= 128) ||
      !["connected", "disconnected", "unknown"].includes(String(data.connectionState))) throw unavailable();
    return { id: data.id as string | null, state: data.state as WhatsappPairing["state"],
      mode: data.mode as WhatsappPairing["mode"], qr: data.qr as string | null,
      expiresAt: data.expiresAt as number | null, linkedIdentity: data.linkedIdentity as string | null,
      connectionState: data.connectionState as WhatsappPairing["connectionState"] };
  }
}
