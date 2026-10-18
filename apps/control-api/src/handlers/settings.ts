import { CONTRACT_VERSION, type AdapterConfigPatch, type ContentStudioKeyPatch, type Freshness, type LayoutImportRequest, type SettingsExport, type SettingsPatch, type ThemeImportRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { HimalayaAccountPatch } from "../services/himalaya-account";
import type { TelegramGatewayPatch } from "../services/telegram-gateway";
import type { MessagingGatewayPatch } from "../services/messaging-gateways";
import type { TelephonyProfile } from "../services/telephony";
import type { HimalayaSendRequest } from "../services/himalaya-send";
import { ApiError, forbidden, validationFailed } from "../util/errors";
import { LocationWeatherService } from "../services/location-weather";
import { applyVoicePersona, VOICE_PERSONAS, type VoicePersona } from "../services/voice-persona";
import type { SettingsService } from "../services/settings";
import { localList } from "./meta";

const fresh = (): Freshness => ({ state: "fresh", asOf: new Date().toISOString() });

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: fresh() });
const weatherServices = new WeakMap<SettingsService, LocationWeatherService>();
const voiceChanges = new WeakSet<SettingsService>();
function weatherService(settings: SettingsService): LocationWeatherService {
  let service = weatherServices.get(settings);
  if (!service) { service = new LocationWeatherService(settings); weatherServices.set(settings, service); }
  return service;
}

export const settingsHandlers: Partial<Record<OperationId, Handler>> = {
  async searchLocations(ctx) {
    try {
      const items = await weatherService(ctx.runtime.settings).search(String(ctx.query.q ?? ""), ctx.query.language === "en" ? "en" : "de");
      return { status: 200, body: single({ items, provider: "Open-Meteo" }) };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Bitte")) throw validationFailed(error.message);
      throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Ortssuche ist derzeit nicht erreichbar.", cause: error });
    }
  },
  async getCurrentWeather(ctx) {
    try {
      const data = await weatherService(ctx.runtime.settings).current();
      return { status: 200, body: { contractVersion: CONTRACT_VERSION, data,
        freshness: data?.stale ? { state: "stale", asOf: data.fetchedAt } : fresh() } };
    } catch (error) {
      throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Wetterdaten sind derzeit nicht erreichbar.", cause: error });
    }
  },
  async getCloudTalk(ctx) { return { status: 200, body: single(ctx.runtime.cloudtalk.status()) }; },
  async putCloudTalk(ctx) {
    const result = ctx.runtime.cloudtalk.configure(ctx.body as { agentId?: number; accessKeyId?: string; accessKeySecret?: string;
      ownerPhone?: string; ownerPhoneConfirmed?: boolean; voiceAgentId?: string; remindersEnabled?: boolean; reminderMinutes?: number },
      ctx.mutation.ifMatchVersion ?? -1, ctx.principal!.userId);
    ctx.audit.action = "settings.cloudtalk_updated";
    ctx.audit.severity = "warning";
    ctx.audit.after = { configured: result.configured, agentId: result.agentId };
    return { status: 200, body: single(result) };
  },
  async previewCloudTalkCall(ctx) {
    const { destination } = ctx.body as { destination: string };
    return { status: 200, body: single(ctx.runtime.cloudtalk.preview(destination, ctx.principal!.userId)) };
  },
  async originateCloudTalkCall(ctx) {
    const { destination, previewToken } = ctx.body as { destination: string; previewToken: string };
    const result = await ctx.runtime.cloudtalk.originate(destination, previewToken, ctx.principal!.userId, ctx.idempotencyKey ?? "");
    ctx.audit.action = "telephony.cloudtalk_call_requested";
    ctx.audit.severity = "warning";
    ctx.audit.after = { callId: result.id, state: result.state, replayed: result.replayed ?? false };
    return { status: 200, body: single(result), headers: { "Idempotent-Replayed": String(result.replayed === true) } };
  },
  async getTelephony(ctx) { return { status: 200, body: single(await ctx.runtime.telephony.status()) }; },
  async putTelephony(ctx) {
    const result = await ctx.runtime.telephony.configure(ctx.body as TelephonyProfile, ctx.mutation.ifMatchVersion ?? -1);
    ctx.audit.action = "settings.telephony_updated";
    ctx.audit.severity = "warning";
    ctx.audit.after = { configured: result.configured, ready: result.ready, mode: result.mode };
    return { status: 200, body: single(result) };
  },
  async previewTelephonyCall(ctx) {
    const { destination } = ctx.body as { destination: string };
    return { status: 200, body: single(await ctx.runtime.telephony.preview(destination, ctx.principal!.userId)) };
  },
  async originateTelephonyCall(ctx) {
    const { destination, previewToken } = ctx.body as { destination: string; previewToken: string };
    const result = await ctx.runtime.telephony.originate(destination, previewToken, ctx.principal!.userId, ctx.idempotencyKey ?? "");
    ctx.audit.action = "telephony.call_requested";
    ctx.audit.severity = "warning";
    ctx.audit.after = { callId: result.id, state: result.state, replayed: result.replayed ?? false };
    return { status: 200, body: single(result), headers: { "Idempotent-Replayed": String(result.replayed === true) } };
  },
  async getTelephonyCall(ctx) {
    return { status: 200, body: single(await ctx.runtime.telephony.get(ctx.pathParams.callId!, ctx.principal!.userId)) };
  },
  async hangupTelephonyCall(ctx) {
    const result = await ctx.runtime.telephony.hangup(ctx.pathParams.callId!, ctx.principal!.userId);
    ctx.audit.action = "telephony.hangup_requested";
    ctx.audit.severity = "warning";
    ctx.audit.after = { callId: result.id, state: result.state };
    return { status: 200, body: single(result) };
  },
  async getDiscordGateway(ctx) { return { status: 200, body: single(await ctx.runtime.discordGateway.status()) }; },
  async putDiscordGateway(ctx) {
    const status = await ctx.runtime.discordGateway.update(ctx.body as MessagingGatewayPatch, ctx.mutation.ifMatchVersion ?? -1);
    ctx.audit.action = "settings.discord_gateway_updated";
    ctx.audit.severity = "warning";
    ctx.audit.after = { tokenConfigured: status.tokenConfigured, allowedUserCount: status.allowedUserIds.length,
      allowedChannelCount: status.allowedChannelIds?.length, enabled: status.enabled, applied: status.applied };
    return { status: 200, body: single(status) };
  },
  async getWhatsappGateway(ctx) { return { status: 200, body: single(await ctx.runtime.whatsappGateway.status()) }; },
  async putWhatsappGateway(ctx) {
    const status = await ctx.runtime.whatsappGateway.update(ctx.body as MessagingGatewayPatch, ctx.mutation.ifMatchVersion ?? -1);
    ctx.audit.action = "settings.whatsapp_gateway_updated";
    ctx.audit.severity = "warning";
    ctx.audit.after = { mode: status.mode, allowedUserCount: status.allowedUserIds.length,
      enabled: status.enabled, sessionPresent: status.sessionPresent, applied: status.applied };
    return { status: 200, body: single(status) };
  },
  async getTelegramGateway(ctx) {
    return { status: 200, body: single(await ctx.runtime.telegramGateway.status()) };
  },
  async putTelegramGateway(ctx) {
    const status = await ctx.runtime.telegramGateway.update(ctx.body as TelegramGatewayPatch, ctx.mutation.ifMatchVersion ?? -1);
    ctx.audit.action = "settings.telegram_gateway_updated";
    ctx.audit.severity = "warning";
    ctx.audit.after = { tokenConfigured: status.tokenConfigured, allowedUserCount: status.allowedUserIds.length,
      enabled: status.enabled, applied: status.applied };
    return { status: 200, body: single(status) };
  },
  async sendHimalayaMessage(ctx) {
    const outcome = await ctx.runtime.himalayaSend.send(ctx.body as HimalayaSendRequest,
      ctx.principal!.userId, ctx.idempotencyKey ?? "");
    ctx.audit.action = "communication.himalaya_send";
    ctx.audit.severity = "warning";
    ctx.audit.after = { state: outcome.state, replayed: outcome.replayed };
    return { status: 200, body: single(outcome), headers: { "Idempotent-Replayed": String(outcome.replayed) } };
  },
  async listHimalayaMailboxes(ctx) {
    if (ctx.voiceBridgeAuthorized && !ctx.runtime.auth.ownerPasswordConfigured()) throw forbidden("Besitzerkonto fehlt.");
    return { status: 200, body: single(await ctx.runtime.himalayaAccount.mailboxes()) };
  },
  async listHimalayaEnvelopes(ctx) {
    if (ctx.voiceBridgeAuthorized && !ctx.runtime.auth.ownerPasswordConfigured()) throw forbidden("Besitzerkonto fehlt.");
    return { status: 200, body: single(await ctx.runtime.himalayaAccount.envelopes(
      String(ctx.query.mailbox ?? ""), Number(ctx.query.page ?? 1))) };
  },
  async getHimalayaMessage(ctx) {
    if (ctx.voiceBridgeAuthorized && !ctx.runtime.auth.ownerPasswordConfigured()) throw forbidden("Besitzerkonto fehlt.");
    return { status: 200, body: single(await ctx.runtime.himalayaAccount.message(
      String(ctx.query.mailbox ?? ""), String(ctx.query.id ?? ""))) };
  },
  async getHimalayaAccount(ctx) {
    return { status: 200, body: single(await ctx.runtime.himalayaAccount.status()) };
  },
  async checkHimalayaSmtp(ctx) {
    const result = await ctx.runtime.himalayaAccount.checkSmtp();
    ctx.audit.action = "settings.himalaya_smtp_checked";
    ctx.audit.after = { ok: result.ok };
    return { status: 200, body: single(result) };
  },
  async putHimalayaAccount(ctx) {
    const status = await ctx.runtime.himalayaAccount.update(ctx.body as HimalayaAccountPatch, ctx.mutation.ifMatchVersion ?? -1);
    ctx.audit.action = "settings.himalaya_account_updated";
    ctx.audit.severity = "warning";
    ctx.audit.after = { configured: status.managed && status.credentialsPresent, cliInstalled: status.cliInstalled };
    return { status: 200, body: single(status) };
  },
  async getHermesSkillKeys(ctx) {
    return { status: 200, body: single(await ctx.runtime.hermesSkillKeys.status()) };
  },

  async updateHermesSkillKey(ctx) {
    const { key, value } = ctx.body as { key: string; value: string };
    const status = await ctx.runtime.hermesSkillKeys.update(key, value);
    ctx.audit.action = "settings.hermes_skill_key_updated";
    ctx.audit.severity = "warning";
    ctx.audit.after = { key, configured: status.configured[key as keyof typeof status.configured], applied: status.applied };
    return { status: 200, body: single(status) };
  },
  async checkHermesSkillKey(ctx) {
    const result = await ctx.runtime.hermesSkillKeys.check(ctx.pathParams.key as string);
    ctx.audit.action = "settings.hermes_skill_key_checked";
    ctx.audit.after = { key: result.key, state: result.state };
    return { status: 200, body: single(result) };
  },
  async getObsidianVault(ctx) {
    return { status: 200, body: single(await ctx.runtime.obsidianVault.status()) };
  },

  async getWikiPath(ctx) {
    return { status: 200, body: single(await ctx.runtime.wikiPath.status()) };
  },

  async putWikiPath(ctx) {
    const { path } = ctx.body as { path: string };
    const status = await ctx.runtime.wikiPath.update(path, ctx.mutation.ifMatchVersion ?? -1);
    ctx.audit.action = "settings.wiki_path_updated";
    ctx.audit.after = { configured: status.configured, customized: status.customized, readable: status.readable, applied: status.applied };
    return { status: 200, body: single(status) };
  },

  async putObsidianVault(ctx) {
    const body = ctx.body as { path: string };
    const status = await ctx.runtime.obsidianVault.set(body.path, ctx.mutation.ifMatchVersion ?? -1);
    ctx.audit.action = "settings.obsidian_vault_updated";
    ctx.audit.after = { configured: status.configured, readable: status.readable, applied: status.applied };
    return { status: 200, body: single(status) };
  },
  async getContentStudioKeys(ctx) {
    return { status: 200, body: single(ctx.runtime.contentStudioKeys.status()) };
  },

  async updateContentStudioKey(ctx) {
    const { provider, key } = ctx.body as ContentStudioKeyPatch;
    ctx.runtime.contentStudioKeys.set(provider, key);
    ctx.audit.action = "settings.content_studio_key_updated";
    ctx.audit.severity = "warning";
    ctx.audit.after = { provider, configured: Boolean(key) };
    return { status: 200, body: single(ctx.runtime.contentStudioKeys.status()) };
  },
  async getSettings(ctx) {
    return { status: 200, body: single(ctx.runtime.settings.get()) };
  },

  async updateSettings(ctx) {
    const patch = ctx.body as SettingsPatch;
    const requested = patch.voice?.ttsVoice;
    const previous = ctx.runtime.settings.area("voice").ttsVoice;
    const changeVoice = requested !== undefined && requested !== previous;
    if (patch.voice && voiceChanges.has(ctx.runtime.settings)) {
      throw new ApiError({ code: "CONFLICT", message: "Eine Stimmenänderung läuft bereits." });
    }
    if (changeVoice) {
      if (!VOICE_PERSONAS.includes(requested as VoicePersona)) {
        throw validationFailed("Bitte F.R.I.D.A.Y. oder J.A.R.V.I.S. wählen.", [{ path: "voice.ttsVoice", message: "unbekannte Stimme" }]);
      }
      const originalVersion = ctx.runtime.settings.version();
      if (ctx.mutation.ifMatchVersion !== undefined && ctx.mutation.ifMatchVersion !== originalVersion) {
        throw new ApiError({ code: "CONFLICT", message: "Einstellungen wurden inzwischen geändert. Bitte neu laden." });
      }
      ctx.runtime.settings.validateAreas(patch);
      voiceChanges.add(ctx.runtime.settings);
      try {
        await applyVoicePersona(ctx.runtime, requested as VoicePersona);
        try {
          const result = ctx.runtime.settings.patch(patch, originalVersion);
          ctx.audit.action = "settings.voice_changed";
          ctx.audit.after = { voice: requested, version: result.settings.version };
          return { status: 200, body: single(result.settings) };
        } catch (error) {
          try {
            if (!VOICE_PERSONAS.includes(previous as VoicePersona)) throw new Error("Vorherige Stimme unbekannt");
            await applyVoicePersona(ctx.runtime, previous as VoicePersona);
          } catch (recovery) {
            throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Stimme wurde geändert, aber Speichern und Rückkehr zur vorherigen Stimme konnten nicht bestätigt werden. Bitte Sprachdienst prüfen.", cause: recovery });
          }
          throw error;
        }
      } finally {
        voiceChanges.delete(ctx.runtime.settings);
      }
    }
    const { settings, changed } = ctx.runtime.settings.patch(patch, ctx.mutation.ifMatchVersion);
    ctx.audit.action = "settings.updated";
    ctx.audit.after = { areas: changed, version: settings.version };
    // The mock world words its orb/status texts with the assistant name; re-derive them so a rename shows up at once.
    if (changed.includes("profile")) ctx.runtime.world?.refresh();
    return { status: 200, body: single(settings) };
  },

  async getSettingsSchema(ctx) {
    return { status: 200, body: single(ctx.runtime.settings.schema()) };
  },

  async listAdapterSettings(ctx) {
    return { status: 200, body: localList(ctx, ctx.runtime.adapterSettings.list()) };
  },

  async updateAdapterSettings(ctx) {
    const id = ctx.pathParams.id as string;
    const { settings, changed } = await ctx.runtime.adapterSettings.patch(id, ctx.body as AdapterConfigPatch, ctx.mutation.ifMatchVersion);
    ctx.audit.action = "settings.adapter_updated";
    ctx.audit.severity = "warning";
    ctx.audit.adapterId = id;
    // Names only: configuration values and secrets never enter the audit trail.
    ctx.audit.after = { changed, version: settings.version };
    return { status: 200, body: single(settings) };
  },

  async testAdapterSettings(ctx) {
    const result = await ctx.runtime.adapterSettings.test(ctx.pathParams.id as string, ctx.correlationId);
    ctx.audit.adapterId = result.adapterId;
    ctx.audit.after = { success: result.success };
    return { status: 200, body: single(result) };
  },

  async listThemes(ctx) {
    return { status: 200, body: localList(ctx, ctx.runtime.settings.listThemes()) };
  },

  async importTheme(ctx) {
    const request = ctx.body as ThemeImportRequest;
    const theme = ctx.runtime.settings.importTheme(request);
    ctx.audit.action = "settings.theme_imported";
    ctx.audit.after = { themeId: theme.id, activated: Boolean(request.activate) };
    return { status: 201, body: single(theme), headers: { Location: `/api/v1/settings/themes/${theme.id}` } };
  },

  async listLayouts(ctx) {
    return { status: 200, body: localList(ctx, ctx.runtime.settings.listLayouts()) };
  },

  async importLayout(ctx) {
    const request = ctx.body as LayoutImportRequest;
    const layout = ctx.runtime.settings.importLayout(request);
    ctx.audit.action = "settings.layout_imported";
    ctx.audit.after = { layoutId: layout.layoutId, activated: Boolean(request.activate) };
    return { status: 201, body: single(layout), headers: { Location: `/api/v1/settings/layouts/${layout.layoutId}` } };
  },

  async exportSettings(ctx) {
    ctx.audit.action = "settings.exported";
    return { status: 200, body: ctx.runtime.settings.export() };
  },

  async importSettings(ctx) {
    const { settings, repairs } = ctx.runtime.settings.import(ctx.body as SettingsExport);
    ctx.audit.action = "settings.imported";
    ctx.audit.severity = "warning";
    ctx.audit.after = { version: settings.version, repairs };
    return { status: 200, body: single(settings) };
  },
};
