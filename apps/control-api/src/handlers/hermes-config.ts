import { CONTRACT_VERSION, type HermesConfigPatch } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { validationFailed } from "../util/errors";
import { HERMES_MODEL_CREDENTIALS, type HermesPluginPatch, type HermesModelCredentialPatch,
  type HermesConfigPatch as ServiceHermesConfigPatch } from "../services/hermes-config";

const single = <T>(data: T) => ({
  contractVersion: CONTRACT_VERSION,
  data,
  freshness: { state: "fresh" as const, asOf: new Date().toISOString() },
});

export const hermesConfigHandlers: Partial<Record<OperationId, Handler>> = {
  async getHermesModelCatalog(ctx) {
    const providerId = ctx.query.providerId;
    return { status: 200, body: single(await ctx.runtime.hermesConfig.modelCatalog(
      typeof providerId === "string" ? providerId : undefined)) };
  },
  async getHermesConfig(ctx) {
    return { status: 200, body: single(await ctx.runtime.hermesConfig.status()) };
  },
  async patchHermesConfig(ctx) {
    if (ctx.mutation.ifMatchVersion === undefined)
      throw validationFailed("If-Match ist für Hermes-Konfiguration erforderlich.");
    const patch = ctx.body as HermesConfigPatch;
    const status = patch.key === "plugin.activation"
      ? await ctx.runtime.hermesConfig.updatePlugin(patch as HermesPluginPatch, ctx.mutation.ifMatchVersion)
      : HERMES_MODEL_CREDENTIALS.includes(patch.key as typeof HERMES_MODEL_CREDENTIALS[number])
      ? await ctx.runtime.hermesConfig.updateCredential(patch as HermesModelCredentialPatch, ctx.mutation.ifMatchVersion)
      : await ctx.runtime.hermesConfig.update(patch as ServiceHermesConfigPatch, ctx.mutation.ifMatchVersion);
    ctx.audit.action = "settings.hermes_config_updated";
    ctx.audit.after = { key: patch.key, ...(patch.key === "plugin.activation" ? { pluginId: patch.pluginId } : {}),
      persisted: status.write?.persisted, revision: status.revision };
    return { status: 200, body: single(status) };
  },
};
