import { createHash, randomBytes } from "node:crypto";
import type { MailAccount, MailAccountsService } from "./mail-accounts";
import { conflict, validationFailed } from "../util/errors";

const GOOGLE_SCOPE = "https://mail.google.com/";
const MICROSOFT_SCOPES = ["offline_access", "https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"];
function normalizedScopes(provider: "google" | "microsoft", raw: string): Set<string> {
  return new Set(raw.split(/\s+/).filter(Boolean).map((scope) => provider === "microsoft" &&
    (scope === "IMAP.AccessAsUser.All" || scope === "SMTP.Send") ? `https://outlook.office.com/${scope}` : scope));
}
type Flow = { accountId: string; revision: number; ownerId: string; expires: number; provider: "google" | "microsoft";
  clientId: string; tenant: string; verifier?: string; deviceCode?: string; nextPoll?: number; interval?: number };
type Token = { access_token?: unknown; refresh_token?: unknown; scope?: unknown; error?: unknown; interval?: unknown;
  device_code?: unknown; user_code?: unknown; verification_uri?: unknown; expires_in?: unknown };

async function form(url: string, values: Record<string, string>): Promise<Token> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { method: "POST", redirect: "error", signal: controller.signal,
      headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values) });
    const content = await response.text();
    if (content.length > 32_000) throw validationFailed("OAuth-Anbieter antwortet ungültig.");
    const parsed = JSON.parse(content) as Token;
    if (!response.ok && ![400, 401].includes(response.status)) throw validationFailed("OAuth-Anbieter ist nicht erreichbar.");
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) throw validationFailed("OAuth-Anbieter antwortet ungültig.");
    throw error;
  } finally { clearTimeout(timeout); }
}

export class MailOAuthService {
  private readonly flows = new Map<string, Flow>();
  constructor(private readonly accounts: MailAccountsService, private readonly port: number) {}

  private async account(accountId: string): Promise<MailAccount> {
    const account = (await this.accounts.list()).accounts.find((item) => item.id === accountId);
    if (!account || account.authMode === "password") throw validationFailed("OAuth-Konto auswählen und zuerst speichern.");
    if (!account.oauthClientId) throw validationFailed("OAuth Client-ID fehlt.");
    return account;
  }

  private store(flow: Flow): string {
    for (const [key, entry] of this.flows) if (entry.expires <= Date.now()) this.flows.delete(key);
    const id = randomBytes(32).toString("base64url");
    this.flows.set(id, flow);
    return id;
  }

  async start(accountId: string, ownerId: string): Promise<{ flowId: string; authorizationUrl: string | null;
    verificationUri: string | null; userCode: string | null; expiresAt: string }> {
    const account = await this.account(accountId);
    const provider = account.authMode === "google-oauth" ? "google" : "microsoft";
    const flow: Flow = { accountId, revision: account.revision, ownerId, expires: Date.now() + 600_000,
      provider, clientId: account.oauthClientId, tenant: account.oauthTenant };
    if (provider === "google") {
      flow.verifier = randomBytes(48).toString("base64url");
      const flowId = this.store(flow);
      const redirect = this.googleRedirect();
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      for (const [key, value] of Object.entries({ client_id: flow.clientId, redirect_uri: redirect,
        response_type: "code", scope: GOOGLE_SCOPE, access_type: "offline", prompt: "consent", state: flowId,
        code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"), code_challenge_method: "S256" }))
        url.searchParams.set(key, value);
      return { flowId, authorizationUrl: url.toString(), verificationUri: null, userCode: null,
        expiresAt: new Date(flow.expires).toISOString() };
    }
    const tenant = account.oauthTenant;
    if (!/^(common|organizations|consumers|[a-fA-F0-9-]{36})$/.test(tenant)) throw validationFailed("Ungültiger Microsoft Tenant.");
    const result = await form(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`,
      { client_id: account.oauthClientId, scope: MICROSOFT_SCOPES.join(" ") });
    let verificationUri: URL | null = null;
    try { verificationUri = new URL(String(result.verification_uri)); } catch { /* invalid URI */ }
    if (typeof result.device_code !== "string" || typeof result.user_code !== "string" ||
      typeof result.verification_uri !== "string" || !verificationUri || verificationUri.protocol !== "https:" ||
      !["microsoft.com", "www.microsoft.com"].includes(verificationUri.hostname.toLowerCase()) ||
      verificationUri.username || verificationUri.password || verificationUri.port)
      throw validationFailed("Microsoft Geräteautorisierung nicht verfügbar.");
    flow.deviceCode = result.device_code;
    flow.interval = Math.max(5, Math.min(Number(result.interval) || 5, 60));
    flow.nextPoll = Date.now() + flow.interval * 1000;
    flow.expires = Date.now() + Math.min(Number(result.expires_in) || 600, 900) * 1000;
    const flowId = this.store(flow);
    return { flowId, authorizationUrl: null, verificationUri: result.verification_uri, userCode: result.user_code,
      expiresAt: new Date(flow.expires).toISOString() };
  }

  private googleRedirect() { return `http://127.0.0.1:${this.port}/api/v1/integrations/mail/oauth/google/callback`; }

  private flow(id: string, provider: "google" | "microsoft", ownerId?: string): Flow {
    const flow = this.flows.get(id);
    if (!flow || flow.provider !== provider || flow.expires < Date.now() || (ownerId && flow.ownerId !== ownerId))
      throw validationFailed("OAuth-Vorgang abgelaufen. Erneut starten.");
    return flow;
  }

  private async save(flow: Flow, token: Token): Promise<{ authorized: boolean; accountId: string }> {
    // offline_access is a consent/refresh-token grant, not an access-token scope in Microsoft's response.
    const needed = flow.provider === "google" ? [GOOGLE_SCOPE] : MICROSOFT_SCOPES.slice(1);
    const granted = typeof token.scope === "string" ? normalizedScopes(flow.provider, token.scope) : null;
    if (!granted || needed.some((scope) => !granted.has(scope))) throw validationFailed("OAuth-Berechtigung für IMAP und SMTP fehlt.");
    if (typeof token.refresh_token !== "string" || token.refresh_token.length < 16 ||
      typeof token.access_token !== "string") throw validationFailed("Provider hat kein Offline-Refresh-Token erteilt. Einwilligung erneut starten.");
    const account = await this.account(flow.accountId);
    if (account.revision !== flow.revision || account.oauthClientId !== flow.clientId || account.oauthTenant !== flow.tenant)
      throw conflict("Mailkonto wurde während der Autorisierung geändert.");
    await this.accounts.completeOAuth(flow.accountId, flow.revision, token.refresh_token, [...granted]);
    return { authorized: true, accountId: flow.accountId };
  }

  async googleCallback(state: string, code: string, ip: string): Promise<{ authorized: boolean; accountId: string }> {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) throw validationFailed("OAuth-Rückruf nur lokal erlaubt.");
    const flow = this.flow(state, "google");
    this.flows.delete(state);
    if (!/^[\w./~-]{8,4096}$/.test(code)) throw validationFailed("OAuth-Code ungültig.");
    const token = await form("https://oauth2.googleapis.com/token", { client_id: flow.clientId, code,
      code_verifier: flow.verifier!, redirect_uri: this.googleRedirect(), grant_type: "authorization_code" });
    return this.save(flow, token);
  }

  async microsoftPoll(flowId: string, ownerId: string, accountId: string): Promise<{ authorized: boolean; pending: boolean; accountId: string }> {
    const flow = this.flow(flowId, "microsoft", ownerId);
    if (flow.accountId !== accountId) throw validationFailed("OAuth-Vorgang gehört zu einem anderen Konto.");
    if (Date.now() < (flow.nextPoll ?? 0)) return { authorized: false, pending: true, accountId: flow.accountId };
    flow.nextPoll = Date.now() + (flow.interval ?? 5) * 1000;
    const token = await form(`https://login.microsoftonline.com/${flow.tenant}/oauth2/v2.0/token`,
      { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: flow.clientId, device_code: flow.deviceCode! });
    if (token.error === "authorization_pending") return { authorized: false, pending: true, accountId: flow.accountId };
    if (token.error === "slow_down") { flow.interval = Math.min((flow.interval ?? 5) + 5, 60); return { authorized: false, pending: true, accountId: flow.accountId }; }
    this.flows.delete(flowId);
    if (token.error) throw validationFailed("Microsoft-Autorisierung abgelehnt oder abgelaufen. Erneut starten.");
    return { ...await this.save(flow, token), pending: false };
  }
}
