import { CONTRACT_VERSION, type AdapterConfigPatch, type Freshness, type LayoutImportRequest, type SettingsExport, type SettingsPatch, type ThemeImportRequest } from "@jarvis/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { localList } from "./meta";

const fresh = (): Freshness => ({ state: "fresh", asOf: new Date().toISOString() });

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: fresh() });

export const settingsHandlers: Partial<Record<OperationId, Handler>> = {
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
