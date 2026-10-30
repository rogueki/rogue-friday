import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";

export interface TelegramGatewayStatus {
  tokenConfigured: boolean;
  botAuthentication: "missing" | "verified" | "invalid" | "unknown";
  botId: string | null;
  botUsername: string | null;
  receiveMode: "polling" | "webhook" | "unknown";
  allowedUserIds: string[];
  allowedChatIds: string[];
  enabled: boolean | null;
  gatewayRunning: boolean | null;
  connectionState: "connected" | "disconnected" | "unknown";
  applied: boolean | null;
  revision: number;
  requireMention: boolean | null;
}

export interface TelegramGatewayPatch {
  token: string;
  clearToken: boolean;
  allowedUserIds: string[];
  allowedChatIds: string[];
  removeWebhook: boolean;
  enabled: boolean;
  requireMention?: boolean;
}

const unavailable = () => new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Telegram-Einrichtung in Friday-Ubuntu ist nicht erreichbar." });
const TOKEN = /^[0-9]{5,20}:[A-Za-z0-9_-]{30,100}$/;
const USER = /^[1-9][0-9]{0,19}$/;
const CHAT = /^-[1-9][0-9]{0,19}$/;

export class TelegramGatewayService {
  constructor(private readonly dataDir: string, private readonly invoke: RunnerInvoker = invokeCodingRunner) {}

  private target(): { script: string; distro: string; user: string } {
    let root = resolve(this.dataDir);
    for (let depth = 0; depth < 5 && !existsSync(join(root, "config", "install-state.json")); depth += 1) root = resolve(root, "..");
    let state: { distro_name?: string; linux_user?: string };
    try { state = JSON.parse(readFileSync(join(root, "config", "install-state.json"), "utf8").replace(/^\uFEFF/, "")) as typeof state; }
    catch { throw unavailable(); }
    if (!state.distro_name || !state.linux_user || !/^[a-zA-Z0-9_.-]+$/.test(state.distro_name) || !/^[a-zA-Z0-9_-]+$/.test(state.linux_user)) throw unavailable();
    const match = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!match) throw unavailable();
    return { distro: state.distro_name, user: state.linux_user,
      script: `/mnt/${match[1]?.toLowerCase()}/${match[2]?.replaceAll("\\", "/")}/installer/wsl/configure_telegram.py` };
  }

  private async run(action: "status" | "update", input?: TelegramGatewayPatch & { revision: number }): Promise<TelegramGatewayStatus> {
    const { script, distro, user } = this.target();
    let data: Record<string, unknown>;
    try { data = await this.invoke(script, distro, user, [action], input ? JSON.stringify(input) : undefined, action === "update" ? 50000 : 20000); }
    catch (error) {
      if (action === "update" && error instanceof Error && error.message.startsWith("runner_3:")) throw conflict("Die Telegram-Konfiguration wurde inzwischen geändert. Bitte neu laden.");
      if (action === "update" && error instanceof Error && error.message.startsWith("runner_4:bot_token_rejected"))
        throw validationFailed("Telegram hat das neue Bot-Token abgelehnt. Das bisher gespeicherte Token bleibt unverändert.");
      if (action === "update" && error instanceof Error && error.message.startsWith("runner_4:bot_unverified"))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
          message: "Telegram war nicht erreichbar, das Bot-Token konnte nicht geprüft werden. Es wurde nichts geändert." });
      if (action === "update" && error instanceof Error && error.message.startsWith("runner_4:webhook_remove_failed"))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Telegram hat das Entfernen des Webhooks nicht bestätigt. Es wurde nichts gespeichert." });
      if (action === "update" && error instanceof Error && error.message.startsWith("runner_4:")) throw validationFailed("Zum Aktivieren oder Webhook-Entfernen werden ein von Telegram bestätigtes Bot-Token und ein freier Polling-Modus ohne Webhook benötigt.");
      throw unavailable();
    }
    if (typeof data.tokenConfigured !== "boolean" || !["missing", "verified", "invalid", "unknown"].includes(String(data.botAuthentication)) ||
        !(data.botId === null || typeof data.botId === "string" && /^[1-9][0-9]{0,19}$/.test(data.botId)) ||
        !(data.botUsername === null || typeof data.botUsername === "string" && /^[A-Za-z0-9_]{5,32}$/.test(data.botUsername)) ||
        !["polling", "webhook", "unknown"].includes(String(data.receiveMode)) || !Array.isArray(data.allowedUserIds) ||
        !data.allowedUserIds.every((id) => typeof id === "string" && USER.test(id)) ||
        !Array.isArray(data.allowedChatIds) || !data.allowedChatIds.every((id) => typeof id === "string" && CHAT.test(id)) ||
        !(data.enabled === null || typeof data.enabled === "boolean") ||
        !(data.gatewayRunning === null || typeof data.gatewayRunning === "boolean") ||
        !["connected", "disconnected", "unknown"].includes(String(data.connectionState)) || !(data.applied === null || typeof data.applied === "boolean") ||
        !Number.isSafeInteger(data.revision) || !(data.requireMention === null || typeof data.requireMention === "boolean")) throw unavailable();
    return data as unknown as TelegramGatewayStatus;
  }

  status(): Promise<TelegramGatewayStatus> { return this.run("status"); }

  update(input: TelegramGatewayPatch, revision: number): Promise<TelegramGatewayStatus> {
    if (!Number.isSafeInteger(revision) || typeof input.token !== "string" ||
        (input.token !== "" && !TOKEN.test(input.token)) || typeof input.clearToken !== "boolean" ||
        (input.clearToken && !!input.token) || !Array.isArray(input.allowedUserIds) ||
        input.allowedUserIds.length > 10 || input.allowedUserIds.some((id) => typeof id !== "string" || !USER.test(id)) ||
        new Set(input.allowedUserIds).size !== input.allowedUserIds.length ||
        !Array.isArray(input.allowedChatIds) || input.allowedChatIds.length > 20 ||
        input.allowedChatIds.some((id) => typeof id !== "string" || !CHAT.test(id)) ||
        new Set(input.allowedChatIds).size !== input.allowedChatIds.length || typeof input.removeWebhook !== "boolean" ||
        typeof input.enabled !== "boolean" || !(input.requireMention === undefined || typeof input.requireMention === "boolean")) {
      throw validationFailed("Telegram-Bot-Token, erlaubte User-IDs oder Gruppen-Chat-IDs sind ungültig.");
    }
    return this.run("update", { ...input, revision });
  }
}
