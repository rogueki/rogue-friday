import { CONTRACT_VERSION, type HermesConfigPatch, type HermesCronMutationRequest, type HermesCronMutationReceipt } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { ApiError, conflict, validationFailed } from "../util/errors";
import type { NativeExecutableAction } from "../services/native-approval-requests";
import { HERMES_MODEL_CREDENTIALS, type HermesPluginPatch, type HermesMcpPatch, type HermesMcpActivationPatch, type HermesMcpBearerPatch, type HermesModelCredentialPatch,
  type HermesConfigPatch as ServiceHermesConfigPatch } from "../services/hermes-config";

const single = <T>(data: T) => ({
  contractVersion: CONTRACT_VERSION,
  data,
  freshness: { state: "fresh" as const, asOf: new Date().toISOString() },
});

const PREVIEW_ID = /^corr_[0-9A-Za-z]{26}$/;

async function mutateCron(ctx: Parameters<Handler>[0]) {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const body = ctx.body as HermesCronMutationRequest;
  const action: NativeExecutableAction = { kind: "hermesCron.mutate", body };
  const previewId = ctx.headers["x-action-preview-id"];
  if (previewId !== undefined && !PREVIEW_ID.test(previewId))
    throw validationFailed("Die Vorschaukennung ist ungueltig.");
  if (ctx.headers["x-action-preview-cancel"] !== undefined) {
    if (!previewId || ctx.headers["x-action-preview-cancel"] !== "true")
      throw validationFailed("Zum Verwerfen ist die passende Vorschaukennung erforderlich.");
    ctx.runtime.nativeApprovals.cancelDraft(ownerId, previewId, action);
    ctx.audit.action = "settings.hermes_cron_draft_discarded";
    return { status: 204 };
  }
  if (!previewId) {
    const observed = await ctx.runtime.hermesConfig.cronJobs();
    if (observed.storeRevision !== body.expectedStoreRevision || observed.profile !== body.profile ||
        observed.profileTimezone !== body.profileTimezone)
      throw conflict("Hermes-Zeitplan hat sich geaendert; Status neu laden.");
    const label = body.action === "create" ? body.name : body.jobId;
    const requestKey = ctx.correlationId;
    ctx.runtime.nativeApprovals.propose({ ownerId, requestKey, correlationId: ctx.correlationId,
      riskTier: 2, type: "system_change", action: `Hermes-Zeitplan ${body.action}: ${label ?? ""}`,
      rationale: "Native Cron-Aktion aus bestaetigter API-Anfrage",
      preview: { kind: "text", title: "Hermes-Zeitplan", body: JSON.stringify({ action: body.action,
        target: label, schedule: body.schedule, profile: body.profile, timezone: body.profileTimezone }) },
      impacts: [], execution: action });
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Zeitplanaktion zuerst bestaetigen.",
      details: { stage: "preview", previewId: requestKey,
        previewText: `Hermes-Zeitplan ${String(label ?? "")} ${body.action}?` } });
  }
  const policy = ctx.runtime.nativeApprovals.confirm(ownerId, previewId, action);
  if (policy.approval) throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Zeitplanaktion wartet auf Freigabe.",
    details: { stage: "approval", approvalId: policy.approval.id,
      targetRoute: `/approvals?approval=${policy.approval.id}` } });
  const serialized = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId, async (saved) => {
    if (saved.kind !== "hermesCron.mutate") throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
    return JSON.stringify(await ctx.runtime.hermesConfig.mutateCron(saved.body));
  });
  const receipt = JSON.parse(serialized) as HermesCronMutationReceipt;
  ctx.audit.action = `settings.hermes_cron_${body.action}`;
  ctx.audit.after = { jobId: receipt.jobId, profile: receipt.profile, storeRevision: receipt.storeRevision,
    state: receipt.state, executionVerified: false };
  return { status: 200, body: single(receipt) };
}

export const hermesConfigHandlers: Partial<Record<OperationId, Handler>> = {
  mutateHermesCronJob: mutateCron,
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
