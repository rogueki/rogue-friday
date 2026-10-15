import { CONTRACT_VERSION, type ActionResult, type LoginRequest, type ReauthRequest } from "@friday/sdk";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { Principal } from "../security/auth-service";

const asActor = (principal: Principal): RequestContext["actor"] => ({ type: "user", id: principal.userId, name: principal.displayName });

function actionResult(ctx: RequestContext, message: string, resourceId?: string): ActionResult {
  return {
    contractVersion: CONTRACT_VERSION,
    accepted: true,
    status: "completed",
    correlationId: ctx.correlationId,
    message,
    ...(resourceId ? { resourceId } : {}),
  };
}

export const authHandlers: Partial<Record<OperationId, Handler>> = {
  async login(ctx) {
    const body = ctx.body as LoginRequest;
    const { principal, setCookie } = await ctx.runtime.auth.login(body.username, body.password, ctx.ip);
    ctx.principal = principal;
    ctx.actor = asActor(principal);
    return { status: 200, body: ctx.runtime.auth.sessionResponse(principal, new Date().toISOString()), setCookie };
  },

  async logout(ctx) {
    const principal = ctx.principal as Principal;
    ctx.runtime.auth.logout(principal);
    ctx.runtime.hub.closeSession(principal.session.idHash);
    return { status: 200, body: actionResult(ctx, "Abgemeldet."), setCookie: ctx.runtime.auth.clearCookies() };
  },

  async logoutAll(ctx) {
    const principal = ctx.principal as Principal;
    const removed = ctx.runtime.auth.logoutAll(principal);
    ctx.runtime.hub.closeUser(principal.userId);
    ctx.audit.context = { sessionsRevoked: removed };
    return { status: 200, body: actionResult(ctx, `${removed} Sitzung(en) beendet.`), setCookie: ctx.runtime.auth.clearCookies() };
  },

  async getSession(ctx) {
    const { auth } = ctx.runtime;
    let principal = ctx.principal;
    let setCookie: string[] | undefined;
    if (!principal && auth.devMode) {
      // Dev auth: the first bootstrap call signs the browser in as the dev owner (mock data on loopback only).
      const issued = auth.issueDevSession("owner");
      principal = issued.principal;
      setCookie = issued.setCookie;
      ctx.principal = principal;
    }
    return { status: 200, body: auth.sessionResponse(principal, new Date().toISOString()), ...(setCookie ? { setCookie } : {}) };
  },

  async reauth(ctx) {
    const principal = ctx.principal as Principal;
    const request = ctx.body as ReauthRequest;
    const response = await ctx.runtime.auth.reauth(principal, request.password, ctx.ip);
    return { status: 200, body: response };
  },
};
