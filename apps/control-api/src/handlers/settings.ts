import { CONTRACT_VERSION, type AdapterConfigPatch, type ContentStudioKeyPatch, type Freshness, type LayoutImportRequest, type SettingsExport, type SettingsPatch, type ThemeImportRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { HimalayaAccountPatch } from "../services/himalaya-account";
import type { TelegramGatewayPatch } from "../services/telegram-gateway";
import type { MessagingGatewayPatch } from "../services/messaging-gateways";
import type { HimalayaSendRequest } from "../services/himalaya-send";
import { localList } from "./meta";

const fresh = (): Freshness => ({ state: "fresh", asOf: new Date().toISOString() });

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: fresh() });

export const settingsHandlers: Partial<Record<OperationId, Handler>> = {
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
    return { status: 200, body: single(await ctx.runtime.himalayaAccount.mailboxes()) };
  },
  async listHimalayaEnvelopes(ctx) {
    return { status: 200, body: single(await ctx.runtime.himalayaAccount.envelopes(
      String(ctx.query.mailbox ?? ""), Number(ctx.query.page ?? 1))) };
  },
  async getHimalayaMessage(ctx) {
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
    const { settings, changed } = ctx.runtime.settings.patch(ctx.body as SettingsPatch, ctx.mutation.ifMatchVersion);
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
