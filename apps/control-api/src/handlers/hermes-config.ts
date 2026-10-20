import { CONTRACT_VERSION, type HermesConfigPatch } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { validationFailed } from "../util/errors";
import { HERMES_MODEL_CREDENTIALS, type HermesPluginPatch, type HermesMcpPatch, type HermesMcpActivationPatch, type HermesMcpBearerPatch, type HermesModelCredentialPatch,
  type HermesConfigPatch as ServiceHermesConfigPatch } from "../services/hermes-config";

const single = <T>(data: T) => ({
  contractVersion: CONTRACT_VERSION,
  data,
  freshness: { state: "fresh" as const, asOf: new Date().toISOString() },
});

export const hermesConfigHandlers: Partial<Record<OperationId, Handler>> = {
  async listHermesCronJobs(ctx) {
    return { status: 200, body: single(await ctx.runtime.hermesConfig.cronJobs()) };
  },
  async getHermesModelCatalog(ctx) {
    const providerId = ctx.query.providerId;
    return { status: 200, body: single(await ctx.runtime.hermesConfig.modelCatalog(
      typeof providerId === "string" ? providerId : undefined)) };
  },
  async getHermesConfig(ctx) {
    return { status: 200, body: single(await ctx.runtime.hermesConfig.status()) };
  },
  async probeHermesMcp(ctx) {
    if (ctx.mutation.ifMatchVersion === undefined)
      throw validationFailed("If-Match ist fuer die Hermes-MCP-Probe erforderlich.");
    const body = ctx.body as { name: string };
    const result = await ctx.runtime.hermesConfig.probeMcp(body.name, ctx.mutation.ifMatchVersion);
    ctx.audit.action = "settings.hermes_mcp_probed";
    ctx.audit.after = { name: body.name, connected: result.connected, revision: result.revision };
    return { status: 200, body: single(result) };
  },
  async testHermesApproval(ctx) {
    if (ctx.mutation.ifMatchVersion === undefined)
      throw validationFailed("If-Match ist fuer die Hermes-Freigabevorschau erforderlich.");
    const body = ctx.body as { command: string };
    const result = await ctx.runtime.hermesConfig.testApproval(body.command, ctx.mutation.ifMatchVersion);
    ctx.audit.action = "settings.hermes_approval_tested";
    ctx.audit.after = { verdict: result.verdict, backend: result.backend, revision: result.revision };
    return { status: 200, body: single(result) };
  },
  async manageHermesMcpOAuth(ctx) {
    if (ctx.mutation.ifMatchVersion === undefined)
      throw validationFailed("If-Match ist fuer Hermes-MCP-OAuth erforderlich.");
    const body = ctx.body as { action: "start"; name: string } | { action: "status" | "cancel"; flowId: string };
    const result = await ctx.runtime.hermesConfig.manageMcpOAuth(body, ctx.mutation.ifMatchVersion, ctx.principal!.userId);
    ctx.audit.action = "settings.hermes_mcp_oauth";
    ctx.audit.after = { action: body.action, status: result.status, flowId: result.flowId };
    return { status: 200, body: single(result) };
  },
  async patchHermesConfig(ctx) {
    if (ctx.mutation.ifMatchVersion === undefined)
      throw validationFailed("If-Match ist für Hermes-Konfiguration erforderlich.");
    const patch = ctx.body as HermesConfigPatch;
    const status = patch.key === "plugin.activation"
      ? await ctx.runtime.hermesConfig.updatePlugin(patch as HermesPluginPatch, ctx.mutation.ifMatchVersion)
      : patch.key === "mcp.bearerCredential"
      ? await ctx.runtime.hermesConfig.updateMcpBearer(patch as HermesMcpBearerPatch, ctx.mutation.ifMatchVersion)
      : patch.key === "mcp.activation"
      ? await ctx.runtime.hermesConfig.activateMcp(patch as HermesMcpActivationPatch, ctx.mutation.ifMatchVersion)
      : patch.key === "mcp.httpServer"
      ? await ctx.runtime.hermesConfig.updateMcp(patch as HermesMcpPatch, ctx.mutation.ifMatchVersion)
      : HERMES_MODEL_CREDENTIALS.includes(patch.key as typeof HERMES_MODEL_CREDENTIALS[number])
      ? await ctx.runtime.hermesConfig.updateCredential(patch as HermesModelCredentialPatch, ctx.mutation.ifMatchVersion)
      : await ctx.runtime.hermesConfig.update(patch as ServiceHermesConfigPatch, ctx.mutation.ifMatchVersion);
    ctx.audit.action = "settings.hermes_config_updated";
    ctx.audit.after = { key: patch.key, ...(patch.key === "plugin.activation" ? { pluginId: patch.pluginId } : {}),
      ...(patch.key === "mcp.httpServer" || patch.key === "mcp.activation" || patch.key === "mcp.bearerCredential" ? { name: patch.name } : {}),
      persisted: status.write?.persisted, revision: status.revision };
    return { status: 200, body: single(status) };
  },
};
