import { authorize, type ApprovalChannel, type DenyReason } from "@friday/auth";
import { CONTRACT_VERSION, type Approval, type ApprovalDecisionRequest } from "@friday/sdk";
import type { Handler, HandlerResult, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { Principal } from "../security/auth-service";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { LocalCalendarService } from "../services/local-calendar";
import { dispatchKnowledgeAction } from "./knowledge-actions";
import { dispatchAutomationAction } from "./automation-actions";
import { portHandler } from "./ports";
import { PORT_SPEC, isAdapterError } from "@friday/adapter-core";

export const APPROVAL_TOKEN_HEADER = "x-approval-token";
export const APPROVAL_TOKEN_EXPIRES_HEADER = "X-Approval-Token-Expires";
const APPROVE_ACTION = "approvals.approve";

function channelOf(ctx: RequestContext, body: ApprovalDecisionRequest | undefined): ApprovalChannel {
  // A body value cannot override a voice-marked request into the UI tier.
  if (ctx.voiceBridgeAuthorized || body?.inputChannel === "voice" || ctx.headers["x-input-channel"] === "voice") return "voice";
  if (body?.inputChannel === "api" || ctx.headers["x-input-channel"] === "api") return "api";
  return "ui";
}

function denied(reason: DenyReason, tier: number): ApiError {
  switch (reason) {
    case "reauth_required":
      return new ApiError({
        code: "REAUTH_REQUIRED",
        message: "Für diese Freigabe ist eine erneute Authentifizierung nötig.",
        details: { requiredAuth: "reauth", riskTier: tier },
      });
    case "voice_not_allowed":
      return new ApiError({
        code: "FORBIDDEN",
        message: "Freigaben der Risikostufe 3 sind per Sprache allein nicht möglich.",
        details: { riskTier: tier, reason },
      });
    case "forbidden_role":
      return new ApiError({ code: "FORBIDDEN", message: "Für diese Freigabe fehlt die Berechtigung.", details: { riskTier: tier, reason } });
    default:
      return new ApiError({ code: "FORBIDDEN", message: "Diese Aktion ist nicht erlaubt.", details: { reason } });
  }
}

const getApprovalBase = portHandler("approvals", "getApproval", PORT_SPEC.approvals.getApproval);
const listApprovalsBase = portHandler("approvals", "listApprovals", PORT_SPEC.approvals.listApprovals);
const approveBase = portHandler("approvals", "approveApproval", PORT_SPEC.approvals.approveApproval);
const rejectBase = portHandler("approvals", "rejectApproval", PORT_SPEC.approvals.rejectApproval);

function nativeResponse(ctx: RequestContext, approval: Approval): HandlerResult {
  return { status: 200, body: { contractVersion: CONTRACT_VERSION, data: approval,
    freshness: { state: "fresh", asOf: new Date(ctx.runtime.nowMs()).toISOString() } } };
}

/**
 * Approval enforcement (PLAN §32.5): the decision needs a short-lived, single-use approval token that was issued when
 * the approval's details were opened (GET), a tier-3 decision additionally needs a fresh password re-authentication and
 * is refused on the voice channel. Everything is re-checked immediately before the adapter executes.
 */
export const approvalHandlers: Partial<Record<OperationId, Handler>> = {
  async listApprovals(ctx) {
    const ownerId = (ctx.principal as Principal).userId;
    const native = ctx.runtime.nativeApprovals.listApprovals(ownerId).filter((approval) =>
      (!Array.isArray(ctx.query.status) || ctx.query.status.includes(approval.status)) &&
      (!Array.isArray(ctx.query.type) || ctx.query.type.includes(approval.type)) &&
      (!Array.isArray(ctx.query.riskTier) || ctx.query.riskTier.includes(approval.riskTier)) &&
      (!ctx.query.taskId || ctx.query.taskId === approval.taskId) &&
      (!ctx.query.agentId || ctx.query.agentId === approval.agentId));
    let base: HandlerResult;
    try { base = await listApprovalsBase(ctx); }
    catch (error) {
      if (!isAdapterError(error) || !["CAPABILITY_MISSING", "ADAPTER_UNAVAILABLE"].includes(error.code)) throw error;
      return { status: 200, body: { contractVersion: CONTRACT_VERSION, items: native,
        pageInfo: { nextCursor: null, hasNextPage: false, totalCount: native.length },
        freshness: { state: "fresh", asOf: new Date(ctx.runtime.nowMs()).toISOString() },
        sources: native.length ? [native[0]!.source] : [] } };
    }
    const body = base.body as { items: Approval[]; pageInfo: { totalCount?: number }; sources: Approval["source"][] };
    return { ...base, body: { ...body, items: [...native, ...body.items],
      pageInfo: { ...body.pageInfo, totalCount: (body.pageInfo.totalCount ?? body.items.length) + native.length },
      sources: [...body.sources, ...(native.length ? [native[0]!.source] : [])] } };
  },
  async getApproval(ctx) {
    const principal = ctx.principal as Principal;
    const native = ctx.runtime.nativeApprovals.getApproval(principal.userId, ctx.pathParams.id as string);
    const result = native ? nativeResponse(ctx, native) : await getApprovalBase(ctx);
    const approval = (result.body as { data: Approval }).data;
    const mayDecide = authorize(principal.role, "approvals.reject").allowed;
    if (approval.status === "pending" && mayDecide) {
      const { token, claims } = ctx.runtime.approvalTokens.issue({ approvalId: approval.id, userId: principal.userId, action: APPROVE_ACTION });
      return {
        ...result,
        headers: { ...(result.headers ?? {}), "X-Approval-Token": token, [APPROVAL_TOKEN_EXPIRES_HEADER]: new Date(claims.expiresAt).toISOString() },
      };
    }
    return result;
  },

  async approveApproval(ctx) {
    const { runtime } = ctx;
    const principal = ctx.principal as Principal;
    const id = ctx.pathParams.id as string;
    const body = ctx.body as ApprovalDecisionRequest | undefined;
    const native = runtime.nativeApprovals.getApproval(principal.userId, id);
    const approvals = native ? null : runtime.registry.getPort("approvals");
    const current = native ?? (await approvals!.getApproval({ id }, ctx.call)).data;
    const tier = current.riskTier;
    const channel = channelOf(ctx, body);
    ctx.audit.approvalId = id;
    ctx.audit.taskId = current.taskId;
    ctx.audit.agentId = current.agentId;
    ctx.audit.context = { riskTier: tier, inputChannel: channel, type: current.type };

    // 0. a decided or expired approval is a conflict, whatever credentials the caller presents (double click, second tab)
    if (current.status !== "pending") throw conflict(`Die Freigabe ist nicht mehr offen (${current.status}).`, { status: current.status });
    if (current.expiresAt !== null && Date.parse(current.expiresAt) <= runtime.nowMs()) {
      throw conflict("Die Freigabe ist abgelaufen.", { expiresAt: current.expiresAt });
    }

    // 1. role, tier-3 rules (owner only, no voice, fresh re-auth)
    const reauthAt = runtime.auth.reauthAt(principal);
    const decision = authorize(principal.role, APPROVE_ACTION, {
      approvalTier: tier as 1 | 2 | 3,
      channel,
      reauthAt,
      reauthWindowMs: runtime.auth.reauthWindowMs(),
    });
    if (!decision.allowed) throw denied(decision.reason, tier);

    // A tier-3 decision without a re-auth token fails before any credential is spent, so the user can retry right away.
    const needsReauth = tier === 3 || current.requiredAuth === "reauth";
    if (needsReauth && !body?.reauthToken) {
      throw new ApiError({
        code: "REAUTH_REQUIRED",
        message: "Für diese Freigabe ist eine erneute Authentifizierung nötig.",
        details: { requiredAuth: "reauth", riskTier: tier },
      });
    }
    if (native && body?.editedPreview) {
      throw validationFailed("Diese Aktion muss mit ihrer gespeicherten Vorschau entschieden werden.",
        [{ path: "editedPreview", message: "fuer diese Aktion nicht unterstuetzt" }]);
    }

    // 2. approval token (single use; bound to this approval, this user and this action)
    const token = ctx.headers[APPROVAL_TOKEN_HEADER];
    if (!token) {
      throw new ApiError({
        code: "APPROVAL_REQUIRED",
        message: "Das Freigabe-Token fehlt. Bitte die Freigabe öffnen und erneut entscheiden.",
        details: { reason: "missing_approval_token" },
      });
    }
    const consumed = runtime.approvalTokens.consume(token, { approvalId: id, userId: principal.userId, action: APPROVE_ACTION });
    if (!consumed.ok) {
      throw new ApiError({
        code: "APPROVAL_REQUIRED",
        message: consumed.reason === "expired" ? "Das Freigabe-Token ist abgelaufen. Bitte die Freigabe erneut öffnen." : "Das Freigabe-Token ist ungültig oder wurde bereits verwendet.",
        details: { reason: consumed.reason },
      });
    }

    // 3. tier 3: the re-auth token from POST /auth/reauth (single use)
    if (needsReauth) {
      if (!runtime.auth.consumeReauthToken(principal, body?.reauthToken)) {
        throw new ApiError({
          code: "REAUTH_REQUIRED",
          message: "Für diese Freigabe ist eine erneute Authentifizierung nötig.",
          details: { requiredAuth: "reauth", riskTier: tier },
        });
      }
    }

    // 4. final recheck right before execution: state, expiry, version, session
    const latest = runtime.nativeApprovals.getApproval(principal.userId, id) ?? (await approvals!.getApproval({ id }, ctx.call)).data;
    if (latest.status !== "pending") throw conflict(`Die Freigabe ist nicht mehr offen (${latest.status}).`, { status: latest.status });
    if (latest.expiresAt !== null && Date.parse(latest.expiresAt) <= runtime.nowMs()) {
      throw conflict("Die Freigabe ist abgelaufen.", { expiresAt: latest.expiresAt });
    }
    if (ctx.mutation.ifMatchVersion !== undefined && ctx.mutation.ifMatchVersion !== latest.version) {
      throw conflict(`Die Freigabe wurde zwischenzeitlich geändert (erwartet Version ${ctx.mutation.ifMatchVersion}, aktuell ${latest.version}).`, {
        expectedVersion: ctx.mutation.ifMatchVersion,
        currentVersion: latest.version,
      });
    }
    if (!runtime.auth.authenticate(ctx.headers.cookie)) {
      throw new ApiError({ code: "UNAUTHENTICATED", message: "Die Sitzung ist nicht mehr gültig." });
    }

    // The re-auth token is a Control API credential; adapters never see it.
    const { reauthToken: _reauthToken, ...forwarded } = body ?? {};
    ctx.body = forwarded;

    ctx.audit.before = { status: latest.status, version: latest.version };
    ctx.audit.action = "approval.approved";
    const base = native ? nativeResponse(ctx, await runtime.nativeApprovals.approve(principal.userId, id, ctx.actor,
      async (action, idempotencyKey) => {
        const tasks = runtime.registry.getPort("tasks");
        // The decision's own If-Match guards the approval version, never the task version.
        const { ifMatchVersion: _decisionVersion, ...decisionMutation } = ctx.mutation;
        const call = { ...decisionMutation, correlationId: current.correlationId, idempotencyKey };
        if (action.kind === "task.create") {
          const create = tasks.createTask;
          if (!create) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Aufgaben koennen derzeit nicht angelegt werden." });
          return (await create({ body: action.body }, call)).data.id;
        }
        if (action.kind === "task.update") {
          const update = tasks.updateTask;
          if (!update) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Aufgaben koennen derzeit nicht geaendert werden." });
          return (await update({ id: action.id, body: action.body }, call)).data.id;
        }
        if (action.kind === "task.cancel") {
          const cancel = tasks.cancelTask;
          if (!cancel) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Aufgaben koennen derzeit nicht abgebrochen werden." });
          return (await cancel({ id: action.id, body: action.body }, call)).data.id;
        }
        if (action.kind === "task.retry") {
          const retry = tasks.retryTask;
          if (!retry) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Aufgaben koennen derzeit nicht neu gestartet werden." });
          return (await retry({ id: action.id, body: action.body }, call)).data.id;
        }
        // Local calendar writes are Friday's own database rows; no adapter port is involved.
        const calendar = new LocalCalendarService(runtime.db);
        if (action.kind === "calendar.create") return calendar.create(action.body, principal.userId).id;
        if (action.kind === "calendar.update") return calendar.update(action.id, action.body, principal.userId, action.version).id;
        if (action.kind === "calendar.delete") {
          calendar.delete(action.id, principal.userId, action.version);
          return action.id;
        }
        // Mail sends go through the durable send journal: one SMTP attempt per staged action, uncertain on ambiguity.
        if (action.kind === "mail.send") {
          await runtime.mailSend.send(action.accountId, action.body, principal.userId, idempotencyKey);
          return runtime.mailSend.receipt(action.accountId, principal.userId, idempotencyKey).receiptId;
        }
        if (action.kind === "mail.send.clarified") {
          const body = runtime.encryptedClarifiedMailDrafts.consume(principal.userId, action.sessionBinding,
            action.draftId, action.intentHash);
          if (!body) throw conflict("Der verschluesselte Mailentwurf ist abgelaufen oder wurde bereits verwendet.");
          await runtime.mailSend.send(action.accountId, body, principal.userId, idempotencyKey);
          return runtime.mailSend.receipt(action.accountId, principal.userId, idempotencyKey).receiptId;
        }
        if (action.kind === "mail.change") {
          await runtime.mailAccounts.change(action.accountId, action.mailbox, action.uid, action.uidValidity,
            action.change, action.destination);
          return `${action.mailbox}:${action.uid}`;
        }
        // Messenger sends go through the durable send journal: one provider attempt per staged action.
        if (action.kind === "messenger.send") {
          const receipt = await runtime.messengerSend.sendStaged(principal.userId, action.draft, idempotencyKey);
          return receipt.receiptId;
        }
        // Agent lifecycle and assignment go through the agents port with the decision's idempotency key.
        if (action.kind === "agent.assign") {
          const assign = runtime.registry.getPort("agents").assignTask;
          if (!assign) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Agentenzuweisung ist derzeit nicht verfuegbar." });
          return (await assign({ id: action.id, body: action.body }, call)).data.id;
        }
        if (action.kind === "agent.pause" || action.kind === "agent.resume" || action.kind === "agent.stop") {
          const agents = runtime.registry.getPort("agents");
          const method = action.kind === "agent.pause" ? agents.pauseAgent
            : action.kind === "agent.resume" ? agents.resumeAgent : agents.stopAgent;
          if (!method) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Agentenaktion ist derzeit nicht verfuegbar." });
          return (await method({ id: action.id }, call)).data.id;
        }
        if (action.kind === "codingrun.stop") {
          return (await runtime.codingRuns.stop(action.id)).runId;
        }
        // Memory and file writes go through the memory/files ports with the decision's idempotency key.
        if (action.kind.startsWith("memory.") || action.kind.startsWith("file.")) {
          return (await dispatchKnowledgeAction(runtime, action, call)).receipt;
        }
        // Automation writes go through the automations port with the decision's idempotency key.
        if (action.kind.startsWith("automation.")) {
          return (await dispatchAutomationAction(runtime, action, call)).receipt;
        }
        if (action.kind === "research.create") {
          return (await runtime.research.create(principal.userId, action.body.topic, idempotencyKey, action.providerVersion)).id;
        }
        throw conflict("Aktion ist nicht ausfuehrbar.");
      })) : await approveBase(ctx);
    const result = (base.body as { data: Approval }).data;
    ctx.audit.after = { status: result.status, version: result.version };
    return base;
  },

  async rejectApproval(ctx) {
    ctx.audit.approvalId = ctx.pathParams.id as string;
    ctx.audit.action = "approval.rejected";
    const principal = ctx.principal as Principal;
    const native = ctx.runtime.nativeApprovals.getApproval(principal.userId, ctx.pathParams.id as string);
    if (native && ctx.mutation.ifMatchVersion !== undefined && ctx.mutation.ifMatchVersion !== native.version)
      throw conflict("Die Freigabe wurde zwischenzeitlich geaendert.", { currentVersion: native.version });
    const base = native ? nativeResponse(ctx, ctx.runtime.nativeApprovals.reject(principal.userId, native.id, ctx.actor,
      (ctx.body as ApprovalDecisionRequest | undefined)?.comment ?? null)) : await rejectBase(ctx);
    if (native) {
      const action = ctx.runtime.nativeApprovals.readActionForApproval(principal.userId, native.id);
      if (action?.kind === "mail.send.clarified")
        ctx.runtime.encryptedClarifiedMailDrafts.delete(principal.userId, action.sessionBinding, action.draftId);
    }
    ctx.audit.after = { status: (base.body as { data: Approval }).data.status };
    return base;
  },

  async requestApprovalContext(ctx) {
    ctx.audit.approvalId = ctx.pathParams.id as string;
    ctx.audit.action = "approval.context_requested";
    return portHandler("approvals", "requestApprovalContext", PORT_SPEC.approvals.requestApprovalContext)(ctx);
  },
};

export { CONTRACT_VERSION };
