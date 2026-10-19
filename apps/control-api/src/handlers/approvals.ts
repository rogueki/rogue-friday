import { authorize, type ApprovalChannel, type DenyReason } from "@friday/auth";
import { CONTRACT_VERSION, type Approval, type ApprovalDecisionRequest } from "@friday/sdk";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { Principal } from "../security/auth-service";
import { ApiError, conflict } from "../util/errors";
import { portHandler } from "./ports";
import { PORT_SPEC } from "@friday/adapter-core";

export const APPROVAL_TOKEN_HEADER = "x-approval-token";
export const APPROVAL_TOKEN_EXPIRES_HEADER = "X-Approval-Token-Expires";
const APPROVE_ACTION = "approvals.approve";

function channelOf(ctx: RequestContext, body: ApprovalDecisionRequest | undefined): ApprovalChannel {
  const requested = body?.inputChannel ?? ctx.headers["x-input-channel"];
  if (requested === "voice") return "voice";
  if (requested === "api") return "api";
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
const approveBase = portHandler("approvals", "approveApproval", PORT_SPEC.approvals.approveApproval);

/**
 * Approval enforcement (PLAN §32.5): the decision needs a short-lived, single-use approval token that was issued when
 * the approval's details were opened (GET), a tier-3 decision additionally needs a fresh password re-authentication and
 * is refused on the voice channel. Everything is re-checked immediately before the adapter executes.
 */
export const approvalHandlers: Partial<Record<OperationId, Handler>> = {
  async getApproval(ctx) {
    const result = await getApprovalBase(ctx);
    const principal = ctx.principal as Principal;
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
    const approvals = runtime.registry.getPort("approvals");

    const current = (await approvals.getApproval({ id }, ctx.call)).data;
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
    const latest = (await approvals.getApproval({ id }, ctx.call)).data;
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
    const base = await approveBase(ctx);
    const result = (base.body as { data: Approval }).data;
    ctx.audit.after = { status: result.status, version: result.version };
    return base;
  },

  async rejectApproval(ctx) {
    ctx.audit.approvalId = ctx.pathParams.id as string;
    ctx.audit.action = "approval.rejected";
    const base = await portHandler("approvals", "rejectApproval", PORT_SPEC.approvals.rejectApproval)(ctx);
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
