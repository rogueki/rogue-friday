import { CONTRACT_VERSION, type AdapterConfigPatch, type ContentStudioKeyPatch, type Freshness, type LayoutImportRequest, type SettingsExport, type SettingsPatch, type ThemeImportRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { HimalayaAccountPatch } from "../services/himalaya-account";
import type { TelegramGatewayPatch } from "../services/telegram-gateway";
import type { MessagingGatewayPatch } from "../services/messaging-gateways";
import type { TelephonyProfile } from "../services/telephony";
import type { HimalayaSendRequest } from "../services/himalaya-send";
import { ApiError, conflict, forbidden, validationFailed } from "../util/errors";
import { LocationWeatherService } from "../services/location-weather";
import { applyVoicePersona, VOICE_PERSONAS, type VoicePersona } from "../services/voice-persona";
import { recordAudioAck, recordVoiceAck, recordVoiceSettingsAck } from "../services/integration-status";
import { applyVoiceAudio, voiceRuntimeStatus } from "../services/voice-audio";
import { applyVoiceSettings, readRuntimeVoiceSettings, runtimeVoiceSettings, runtimeVoiceFields } from "../services/voice-settings";
import type { SettingsService } from "../services/settings";
import { localList } from "./meta";
import { captureMailSend } from "./mail-memory";

const fresh = (): Freshness => ({ state: "fresh", asOf: new Date().toISOString() });

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: fresh() });
const weatherServices = new WeakMap<SettingsService, LocationWeatherService>();
const voiceChanges = new WeakSet<SettingsService>();
async function legacyMail(ctx: Parameters<Handler>[0]) {
  const catalog = await ctx.runtime.mailAccounts.list();
  const account = catalog.accounts.find((item) => item.id === catalog.defaultAccountId);
  return { catalog, account };
}
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
  async getWhatsappPairing(ctx) { return { status: 200, body: single(await ctx.runtime.whatsappGateway.pairing("status")),
    headers: { "Cache-Control": "no-store" } }; },
  async startWhatsappPairing(ctx) {
    const { mode } = ctx.body as { mode: "bot" | "self-chat" };
    const pairing = await ctx.runtime.whatsappGateway.pairing("start", mode);
    ctx.audit.action = "settings.whatsapp_pairing_started";
    ctx.audit.severity = "warning";
    ctx.audit.after = { state: pairing.state };
    return { status: 200, body: single(pairing), headers: { "Cache-Control": "no-store" } };
  },
  async cancelWhatsappPairing(ctx) {
    const pairing = await ctx.runtime.whatsappGateway.pairing("cancel");
    ctx.audit.action = "settings.whatsapp_pairing_cancelled";
    ctx.audit.severity = "warning";
    ctx.audit.after = { state: pairing.state };
    return { status: 200, body: single(pairing), headers: { "Cache-Control": "no-store" } };
  },
  async reconnectWhatsappGateway(ctx) {
    const pairing = await ctx.runtime.whatsappGateway.pairing("reconnect");
    ctx.audit.action = "settings.whatsapp_gateway_reconnected";
    ctx.audit.severity = "warning";
    ctx.audit.after = { state: pairing.state, connectionState: pairing.connectionState };
    return { status: 200, body: single(pairing), headers: { "Cache-Control": "no-store" } };
  },
  async logoutWhatsappGateway(ctx) {
    const pairing = await ctx.runtime.whatsappGateway.pairing("logout");
    ctx.audit.action = "settings.whatsapp_gateway_logged_out";
    ctx.audit.severity = "warning";
    ctx.audit.after = { state: pairing.state };
    return { status: 200, body: single(pairing), headers: { "Cache-Control": "no-store" } };
  },
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
    const { account } = await legacyMail(ctx);
    if (!account) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Mail Postfach ist nicht eingerichtet." });
    const result = await ctx.runtime.mailSend.send(account.id, ctx.body as HimalayaSendRequest,
      ctx.principal!.userId, ctx.idempotencyKey ?? "");
    const memoryCapture = captureMailSend(ctx, account.id, ctx.principal!.userId, ctx.principal!.userId, "dashboard", result.state);
    const outcome = { state: result.state === "uncertain" ? "unknown" as const : "sent" as const, replayed: result.replayed };
    ctx.audit.action = "communication.himalaya_send";
    ctx.audit.severity = "warning";
    ctx.audit.after = { state: outcome.state, replayed: outcome.replayed, memoryCapture };
    return { status: 200, body: single(outcome), headers: { "Idempotent-Replayed": String(outcome.replayed) } };
  },
  async listHimalayaMailboxes(ctx) {
    if (ctx.voiceBridgeAuthorized && !ctx.runtime.auth.ownerPasswordConfigured()) throw forbidden("Besitzerkonto fehlt.");
    const { account } = await legacyMail(ctx);
    if (!account) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Mail Postfach ist nicht eingerichtet." });
    const result = await ctx.runtime.mailAccounts.folders(account.id);
    return { status: 200, body: single({ mailboxes: result.folders.map((item) => ({ ...item, role: item.role ?? (item.id.toLowerCase() === "inbox" ? "inbox" : null) })) }) };
  },
  async listHimalayaEnvelopes(ctx) {
    if (ctx.voiceBridgeAuthorized && !ctx.runtime.auth.ownerPasswordConfigured()) throw forbidden("Besitzerkonto fehlt.");
    const { account } = await legacyMail(ctx);
    if (!account) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Mail Postfach ist nicht eingerichtet." });
    const result = await ctx.runtime.mailAccounts.envelopes(account.id, String(ctx.query.mailbox ?? ""), Number(ctx.query.page ?? 1));
    return { status: 200, body: single({ mailbox: result.mailbox, page: result.page, items: result.items.map((row) => {
      const item = row as { id: string; subject: string; from: string; date: string; flags?: string[] };
      return { id: item.id, subject: item.subject, from: [{ address: item.from }], date: item.date, flags: item.flags ?? [] };
    }) }) };
  },
  async getHimalayaMessage(ctx) {
    if (ctx.voiceBridgeAuthorized && !ctx.runtime.auth.ownerPasswordConfigured()) throw forbidden("Besitzerkonto fehlt.");
    const { account } = await legacyMail(ctx);
    if (!account) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Mail Postfach ist nicht eingerichtet." });
    const mailbox = String(ctx.query.mailbox ?? "");
    const selection = await ctx.runtime.mailAccounts.envelopes(account.id, mailbox, 1);
    if (!selection.uidValidity) throw conflict("Ordnerkennung fehlt. Bitte erneut laden.");
    const result = await ctx.runtime.mailAccounts.message(account.id, mailbox, String(ctx.query.id ?? ""), selection.uidValidity);
    const { attachments: _attachments, uid: id, uidValidity: _uidValidity, to: _to, ...compatible } = result;
    return { status: 200, body: single({ ...compatible, id }) };
  },
  async getHimalayaAccount(ctx) {
    const { account } = await legacyMail(ctx);
    const configured = !!account;
    const credentialsPresent = account?.authMode === "password"
      ? !!account.secretState.imapPassword && !!account.secretState.smtpPassword
      : !!account?.secretState.oauthRefreshToken;
    const cliInstalled = await ctx.runtime.himalayaAccount.status().then((status) => status.cliInstalled, () => false);
    return { status: 200, body: single({ managed: configured, configPresent: configured, credentialsPresent,
      cliInstalled, readyForLocalUse: account?.authMode === "password" && configured && credentialsPresent,
      connectionChecked: false, revision: account?.revision ?? 0 }) };
  },
  async checkHimalayaSmtp(ctx) {
    const { account } = await legacyMail(ctx);
    if (!account) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Mail Postfach ist nicht eingerichtet." });
    const result = await ctx.runtime.mailAccounts.check(account.id, "smtp");
    ctx.audit.action = "settings.himalaya_smtp_checked";
    ctx.audit.after = { ok: result.ok };
    return { status: 200, body: single(result) };
  },
  async putHimalayaAccount(ctx) {
    const input = ctx.body as HimalayaAccountPatch;
    const { account } = await legacyMail(ctx);
    if ((account?.revision ?? 0) !== ctx.mutation.ifMatchVersion) throw conflict("Das Mail Postfach wurde inzwischen geaendert. Bitte neu laden.");
    const created = await ctx.runtime.mailAccounts.upsert({ id: account?.id ?? "friday", displayName: input.displayName,
      email: input.email, senderName: input.displayName, aliases: account?.aliases ?? [], signature: account?.signature ?? "",
      imapHost: input.imapHost, imapPort: input.imapPort, imapSecurity: "tls", imapLogin: input.imapLogin,
      smtpHost: input.smtpHost, smtpPort: input.smtpPort, smtpSecurity: input.smtpEncryption, smtpLogin: input.smtpLogin,
      sentFolder: input.sentFolder, draftsFolder: input.draftsFolder, trashFolder: input.trashFolder,
      archiveFolder: account?.archiveFolder ?? "Archive", spamFolder: account?.spamFolder ?? "Spam" },
    { imapPassword: input.imapPassword, smtpPassword: input.smtpPassword }, account?.revision ?? null);
    const cliInstalled = await ctx.runtime.himalayaAccount.status().then((status) => status.cliInstalled, () => false);
    const status = { managed: true, configPresent: true, credentialsPresent: true, cliInstalled,
      readyForLocalUse: true, connectionChecked: false, revision: created.revision };
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
    try { ctx.runtime.durableMemory.prepareVaultSwitch(body.path); }
    catch { throw conflict("Der neue Vault ist nicht bereit oder enthält widersprüchliche Friday-Notizen."); }
    const status = await ctx.runtime.obsidianVault.set(body.path, ctx.mutation.ifMatchVersion ?? -1);
    if (status.readable && status.applied) {
      try { ctx.runtime.durableMemory.switchVault(body.path); }
      catch { throw conflict("Hermes nutzt den neuen Vault, Friday konnte seine Notizen nicht sicher übernehmen. Bitte Vault prüfen."); }
    }
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
    if (patch.developer?.scenarioConsole && (!ctx.runtime.engine || !ctx.runtime.config.dev.scenarioConsole)) {
      throw validationFailed("Die Szenario-Konsole ist nur mit aktiviertem Mock-Szenariolaufzeit verfügbar.", [{ path: "developer.scenarioConsole", message: "Mock-Szenariolaufzeit ist nicht aktiv" }]);
    }
    const requested = patch.voice?.ttsVoice;
    const previousVoice = ctx.runtime.settings.area("voice");
    const previous = previousVoice.ttsVoice;
    const changeVoice = requested !== undefined && requested !== previous;
    const input = patch.voice?.inputDeviceId !== undefined ? patch.voice.inputDeviceId : previousVoice.inputDeviceId;
    const output = patch.voice?.outputDeviceId !== undefined ? patch.voice.outputDeviceId : previousVoice.outputDeviceId;
    const changeAudio = patch.voice !== undefined && (input !== previousVoice.inputDeviceId || output !== previousVoice.outputDeviceId);
    let requestedRuntime = patch.voice ? runtimeVoiceSettings(patch.voice) : null;
    const changeRuntime = requestedRuntime !== null && runtimeVoiceFields.some((field) => requestedRuntime![field] !== previousVoice[field]);
    if (patch.voice && voiceChanges.has(ctx.runtime.settings)) {
      throw new ApiError({ code: "CONFLICT", message: "Eine Stimmenänderung läuft bereits." });
    }
    if (changeVoice || changeAudio || changeRuntime) {
      if (changeVoice && !VOICE_PERSONAS.includes(requested as VoicePersona)) {
        throw validationFailed("Bitte F.R.I.D.A.Y. oder J.A.R.V.I.S. wählen.", [{ path: "voice.ttsVoice", message: "unbekannte Stimme" }]);
      }
      const originalVersion = ctx.runtime.settings.version();
      if (ctx.mutation.ifMatchVersion !== undefined && ctx.mutation.ifMatchVersion !== originalVersion) {
        throw new ApiError({ code: "CONFLICT", message: "Einstellungen wurden inzwischen geändert. Bitte neu laden." });
      }
      ctx.runtime.settings.validateAreas(patch);
      voiceChanges.add(ctx.runtime.settings);
      let runtimeDefinitivelyRejected = false;
      let runtimeBefore: Awaited<ReturnType<typeof readRuntimeVoiceSettings>> | null = null;
      let voiceBefore: Awaited<ReturnType<typeof voiceRuntimeStatus>> | null = null;
      let voiceAttempted = false;
      let audioAttempted = false;
      let runtimeApplied: Awaited<ReturnType<typeof applyVoiceSettings>> | null = null;
      try {
        try {
          voiceBefore = await voiceRuntimeStatus(ctx.runtime);
          if (changeRuntime && patch.voice && requestedRuntime) {
            runtimeBefore = await readRuntimeVoiceSettings(ctx.runtime);
            if (runtimeBefore.serviceStartedAt !== voiceBefore.service_started_at)
              throw new ApiError({ code: "CONFLICT", message: "Sprachdienst wurde während des Einlesens neu gestartet. Bitte erneut speichern." });
            const fromDisk = { ...runtimeBefore.settings };
            for (const field of runtimeVoiceFields) {
              if (patch.voice[field] !== previousVoice[field]) (fromDisk as Record<string, unknown>)[field] = patch.voice[field];
            }
            requestedRuntime = fromDisk;
            patch.voice = { ...patch.voice, ...fromDisk };
          }
          if (changeVoice) { voiceAttempted = true; await applyVoicePersona(ctx.runtime, requested as VoicePersona); }
          let audioInstance: string | null = null;
          if (changeAudio) { audioAttempted = true; audioInstance = await applyVoiceAudio(ctx.runtime, input, output); }
          let runtimeInstance: string | null = null;
          if (changeRuntime) {
            const applySnapshot = await readRuntimeVoiceSettings(ctx.runtime);
            if (!runtimeBefore || applySnapshot.serviceStartedAt !== runtimeBefore.serviceStartedAt)
              throw new ApiError({ code: "CONFLICT", message: "Sprachdienst wurde während der Änderung neu gestartet. Bitte neu laden." });
            const previousRuntimeSettings = runtimeBefore.settings;
            if (runtimeVoiceFields.some((field) => applySnapshot.settings[field] !== previousRuntimeSettings[field]))
              throw new ApiError({ code: "CONFLICT", message: "Sprachrichtlinie wurde während der Änderung geändert. Bitte neu laden." });
            try {
              runtimeApplied = await applyVoiceSettings(ctx.runtime, requestedRuntime!, applySnapshot);
              runtimeInstance = runtimeApplied.serviceStartedAt;
            }
            catch (error) {
              runtimeDefinitivelyRejected = error instanceof ApiError && error.code === "VALIDATION_FAILED";
              throw error;
            }
          }
          const status = await voiceRuntimeStatus(ctx.runtime);
          const instance = status.service_started_at;
          if (typeof instance !== "string" || (changeVoice && status.tts_voice_choice !== requested) ||
              (audioInstance && instance !== audioInstance) || (runtimeInstance && instance !== runtimeInstance))
            throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst hat die Änderung nicht bestätigt." });
          const result = ctx.runtime.settings.patch(patch, originalVersion);
          if (patch.approvals && ctx.runtime.world) ctx.runtime.world.state.settings.approvals = structuredClone(result.settings.approvals);
          if (result.changed.includes("developer")) ctx.runtime.logger.setLevel?.(result.settings.developer.logLevel);
          if (changeVoice) recordVoiceAck(ctx.runtime, result.settings.version, requested as VoicePersona, instance);
          if (changeAudio) recordAudioAck(ctx.runtime, result.settings.version, input, output, instance);
          if (changeRuntime) recordVoiceSettingsAck(ctx.runtime, result.settings.version, requestedRuntime!, instance);
          ctx.audit.action = "settings.voice_changed";
          ctx.audit.after = { ...(changeVoice ? { voice: requested } : {}), ...(changeAudio ? { audioDeviceChanged: true } : {}), version: result.settings.version };
          return { status: 200, body: single(result.settings) };
        } catch (error) {
          const recoveryErrors: unknown[] = [];
          if (runtimeApplied && runtimeBefore && !runtimeDefinitivelyRejected) {
            try { await applyVoiceSettings(ctx.runtime, runtimeBefore.settings, runtimeApplied); }
            catch (recovery) { recoveryErrors.push(recovery); }
          }
          if (audioAttempted) {
            try { await applyVoiceAudio(ctx.runtime,
              typeof voiceBefore?.input_device_id === "string" || voiceBefore?.input_device_id === null ? voiceBefore.input_device_id : previousVoice.inputDeviceId,
              typeof voiceBefore?.output_device_id === "string" || voiceBefore?.output_device_id === null ? voiceBefore.output_device_id : previousVoice.outputDeviceId); }
            catch (recovery) { recoveryErrors.push(recovery); }
          }
          if (voiceAttempted) {
            try {
              const actual = typeof voiceBefore?.tts_voice_choice === "string" ? voiceBefore.tts_voice_choice : previous;
              if (!VOICE_PERSONAS.includes(actual as VoicePersona)) throw new Error("Vorherige Stimme unbekannt", { cause: error });
              await applyVoicePersona(ctx.runtime, actual as VoicePersona);
            } catch (recovery) { recoveryErrors.push(recovery); }
          }
          if (recoveryErrors.length)
            throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachänderung und Rückkehr zur vorherigen Konfiguration konnten nicht bestätigt werden. Bitte Sprachdienst prüfen.", cause: new AggregateError(recoveryErrors, "Voice rollback incomplete") });
          throw error;
        }
      } finally {
        voiceChanges.delete(ctx.runtime.settings);
      }
    }
    const { settings, changed } = ctx.runtime.settings.patch(patch, ctx.mutation.ifMatchVersion);
    if (changed.includes("approvals") && ctx.runtime.world) ctx.runtime.world.state.settings.approvals = structuredClone(settings.approvals);
    if (changed.includes("developer")) ctx.runtime.logger.setLevel?.(settings.developer.logLevel);
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
    const document = ctx.body as SettingsExport;
    const importedVoice = document.settings.voice;
    const beforeVoice = ctx.runtime.settings.area("voice");
    const voiceChanged = importedVoice && Object.keys(importedVoice).some((key) =>
      importedVoice[key as keyof typeof importedVoice] !== beforeVoice[key as keyof typeof beforeVoice]);
    let restoreVoice = beforeVoice;
    let effectiveDocument = document;
    if (voiceChanged) {
      const raw = await voiceRuntimeStatus(ctx.runtime);
      const live = await readRuntimeVoiceSettings(ctx.runtime);
      restoreVoice = { ...beforeVoice, ...live.settings,
        ttsVoice: typeof raw.tts_voice_choice === "string" ? raw.tts_voice_choice : beforeVoice.ttsVoice,
        inputDeviceId: typeof raw.input_device_id === "string" || raw.input_device_id === null ? raw.input_device_id : beforeVoice.inputDeviceId,
        outputDeviceId: typeof raw.output_device_id === "string" || raw.output_device_id === null ? raw.output_device_id : beforeVoice.outputDeviceId };
      const applied = await settingsHandlers.updateSettings!({ ...ctx, body: { voice: importedVoice },
        mutation: { ...ctx.mutation, ifMatchVersion: ctx.runtime.settings.version() } });
      // The voice bridge may preserve a legacy value that the export did not actually change.
      // Import the acknowledged values, otherwise the second write would undo that reconciliation.
      const appliedVoice = (applied.body as { data: { voice: typeof beforeVoice } }).data.voice;
      effectiveDocument = { ...document, settings: { ...document.settings, voice: appliedVoice } };
    }
    let result: ReturnType<SettingsService["import"]>;
    try { result = ctx.runtime.settings.import(effectiveDocument); }
    catch (error) {
      if (voiceChanged) {
        try { await settingsHandlers.updateSettings!({ ...ctx, body: { voice: restoreVoice },
          mutation: { ...ctx.mutation, ifMatchVersion: ctx.runtime.settings.version() } }); }
        catch (recovery) {
          throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Import und Rückkehr zur vorherigen Spracheinstellung konnten nicht bestätigt werden.",
            cause: new AggregateError([error, recovery], "Import rollback incomplete") });
        }
      }
      throw error;
    }
    const { settings, repairs } = result;
    if (voiceChanged) {
      const raw = await voiceRuntimeStatus(ctx.runtime);
      const instance = raw.service_started_at;
      if (typeof instance !== "string") throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Importiert, aber Sprachdienst-Readback fehlt." });
      recordVoiceSettingsAck(ctx.runtime, settings.version, runtimeVoiceSettings(settings.voice), instance);
      if (typeof raw.tts_voice_choice === "string" && raw.tts_voice_choice === settings.voice.ttsVoice)
        recordVoiceAck(ctx.runtime, settings.version, settings.voice.ttsVoice, instance);
      if (raw.input_device_id === settings.voice.inputDeviceId && raw.output_device_id === settings.voice.outputDeviceId)
        recordAudioAck(ctx.runtime, settings.version, settings.voice.inputDeviceId, settings.voice.outputDeviceId, instance);
    }
    ctx.audit.action = "settings.imported";
    ctx.audit.severity = "warning";
    ctx.audit.after = { version: settings.version, repairs };
    return { status: 200, body: single(settings) };
  },
};
