import { createHash } from "node:crypto";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  ApprovalTokenService,
  LoginRateLimiter,
  assertDevAuthAllowed,
  clearCsrfCookie,
  clearSessionCookie,
  hasFreshReauth,
  isRole,
  issueCsrfToken,
  parseCookies,
  serializeCsrfCookie,
  serializeSessionCookie,
  verifyCsrfToken,
  verifyPassword,
  type Role,
  type Session,
  type SessionStore,
} from "@jarvis/auth";
import { resolveSecret, type JarvisConfig } from "@jarvis/config";
import { CONTRACT_VERSION, type ReauthResponse, type SessionResponse } from "@jarvis/sdk";
import { ApiError } from "../util/errors";

export interface Principal {
  userId: string;
  displayName: string;
  role: Role;
  mode: "local" | "dev";
  /** Raw cookie value; only used to derive the CSRF token and approval bindings, never logged or stored. */
  sessionId: string;
  session: Session;
}

export interface CookieSet {
  setCookie: string[];
}

export interface AuthServiceDeps {
  config: JarvisConfig;
  sessions: SessionStore;
  csrfKey: Buffer;
  approvalTokens: ApprovalTokenService;
  limiter: LoginRateLimiter;
  env: NodeJS.ProcessEnv;
  displayName: () => string;
  now?: () => number;
}

/** Deterministic `usr_` ids (contract: `^usr_[0-9A-Za-z]{26}$`) derived from a stable label. */
export function stableUserId(label: string): string {
  return `usr_${createHash("sha256").update(`jarvis-user:${label}`).digest("hex").slice(0, 26).toUpperCase()}`;
}

const OWNER_USER_ID = stableUserId("owner");
const DEV_USER_IDS: Record<Role, string> = {
  owner: stableUserId("dev-owner"),
  operator: stableUserId("dev-operator"),
  viewer: stableUserId("dev-viewer"),
};
const DEV_USERS: Record<string, Role> = {
  "dev-owner": "owner",
  "dev-operator": "operator",
  "dev-viewer": "viewer",
  owner: "owner",
  operator: "operator",
  viewer: "viewer",
};

/** Sessions, CSRF, login throttling and re-authentication on top of `@jarvis/auth` (SECURITY.md §3). */
export class AuthService {
  private readonly now: () => number;

  constructor(private readonly deps: AuthServiceDeps) {
    this.now = deps.now ?? Date.now;
    if (deps.config.auth.mode === "dev") {
      assertDevAuthAllowed({ dataMode: deps.config.dataMode, host: deps.config.server.host });
    }
  }

  get devMode(): boolean {
    return this.deps.config.auth.mode === "dev";
  }

  /** Resolves the principal from the `Cookie` header; refreshes the sliding idle timeout. */
  authenticate(cookieHeader: string | undefined): Principal | null {
    const sessionId = parseCookies(cookieHeader)[SESSION_COOKIE];
    if (!sessionId) return null;
    const session = this.deps.sessions.get(sessionId);
    if (!session) return null;
    return this.principalOf(sessionId, session);
  }

  private principalOf(sessionId: string, session: Session): Principal {
    const dev = this.devMode && Object.values(DEV_USER_IDS).includes(session.userId);
    return {
      userId: session.userId,
      displayName: dev ? `Dev ${session.role}` : this.deps.displayName(),
      role: isRole(session.role) ? session.role : "viewer",
      mode: dev ? "dev" : "local",
      sessionId,
      session,
    };
  }

  csrfTokenFor(principal: Principal): string {
    return issueCsrfToken(this.deps.csrfKey, principal.sessionId);
  }

  /** Double-submit check: header must match the session-bound HMAC and, when present, the readable cookie. */
  verifyCsrf(principal: Principal, headers: Record<string, string | undefined>): boolean {
    const header = headers[CSRF_HEADER];
    const cookie = parseCookies(headers.cookie)[CSRF_COOKIE];
    return verifyCsrfToken(this.deps.csrfKey, principal.sessionId, header, cookie);
  }

  private cookiesFor(sessionId: string): string[] {
    const options = { secureCookies: this.deps.config.auth.secureCookies, maxAgeSeconds: this.deps.config.auth.sessionTtlMinutes * 60 };
    return [serializeSessionCookie(sessionId, options), serializeCsrfCookie(issueCsrfToken(this.deps.csrfKey, sessionId), options)];
  }

  clearCookies(): string[] {
    const secure = this.deps.config.auth.secureCookies;
    return [clearSessionCookie(secure), clearCsrfCookie(secure)];
  }

  private createSession(userId: string, role: Role): { sessionId: string; session: Session } {
    const { sessionId, session } = this.deps.sessions.create({
      userId,
      role,
      ttlMs: this.deps.config.auth.sessionTtlMinutes * 60_000,
      idleTimeoutMs: this.deps.config.auth.idleTimeoutMinutes * 60_000,
    });
    return { sessionId, session };
  }

  /** Dev auth: a session for `dev-<role>` is issued without credentials (mock data and loopback only). */
  issueDevSession(role: Role): { principal: Principal } & CookieSet {
    assertDevAuthAllowed({ dataMode: this.deps.config.dataMode, host: this.deps.config.server.host });
    const { sessionId, session } = this.createSession(DEV_USER_IDS[role], role);
    return { principal: this.principalOf(sessionId, session), setCookie: this.cookiesFor(sessionId) };
  }

  async login(username: string, password: string, ip: string): Promise<{ principal: Principal } & CookieSet> {
    if (this.devMode) {
      const role = DEV_USERS[username.trim().toLowerCase()];
      if (!role || password.length === 0) {
        throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung fehlgeschlagen." });
      }
      return this.issueDevSession(role);
    }

    const decision = this.deps.limiter.check(username, ip);
    if (!decision.allowed) {
      const retryAfterSeconds = Math.ceil(decision.retryAfterMs / 1000);
      throw new ApiError({
        code: "RATE_LIMITED",
        message: "Zu viele Anmeldeversuche. Bitte später erneut versuchen.",
        details: { retryAfterSeconds },
        headers: { "Retry-After": String(retryAfterSeconds) },
      });
    }
    const hash = this.ownerHash();
    const isOwner = username.trim().toLowerCase() === this.deps.config.auth.ownerUsername.toLowerCase();
    // Unknown user and wrong password take the same path (verifyPassword burns one scrypt computation for a missing hash).
    const ok = await verifyPassword(password, isOwner ? hash : undefined);
    if (!ok) {
      this.deps.limiter.recordFailure(username, ip);
      throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung fehlgeschlagen." });
    }
    this.deps.limiter.recordSuccess(username, ip);
    const { sessionId, session } = this.createSession(OWNER_USER_ID, "owner");
    return { principal: this.principalOf(sessionId, session), setCookie: this.cookiesFor(sessionId) };
  }

  private ownerHash(): string | undefined {
    const result = resolveSecret(this.deps.config.auth.ownerPasswordHash.ref, { env: this.deps.env });
    return result.ok ? result.secret.reveal() : undefined;
  }

  ownerPasswordConfigured(): boolean {
    return this.devMode || this.ownerHash() !== undefined;
  }

  logout(principal: Principal): number {
    return this.deps.sessions.revoke(principal.sessionId) ? 1 : 0;
  }

  logoutAll(principal: Principal): number {
    return this.deps.sessions.revokeAll(principal.userId);
  }

  async reauth(principal: Principal, password: string, ip: string): Promise<ReauthResponse> {
    if (!this.devMode) {
      const decision = this.deps.limiter.check(principal.userId, ip);
      if (!decision.allowed) {
        const retryAfterSeconds = Math.ceil(decision.retryAfterMs / 1000);
        throw new ApiError({
          code: "RATE_LIMITED",
          message: "Zu viele Versuche. Bitte später erneut versuchen.",
          details: { retryAfterSeconds },
          headers: { "Retry-After": String(retryAfterSeconds) },
        });
      }
      const ok = await verifyPassword(password, this.ownerHash());
      if (!ok) {
        this.deps.limiter.recordFailure(principal.userId, ip);
        throw new ApiError({ code: "UNAUTHENTICATED", message: "Das Passwort ist nicht korrekt." });
      }
      this.deps.limiter.recordSuccess(principal.userId, ip);
    } else if (password.length === 0) {
      throw new ApiError({ code: "UNAUTHENTICATED", message: "Das Passwort ist nicht korrekt." });
    }
    this.deps.sessions.markReauth(principal.sessionId);
    const { token, claims } = this.deps.approvalTokens.issue({
      approvalId: principal.session.idHash,
      userId: principal.userId,
      action: "auth.reauth",
    });
    return { contractVersion: CONTRACT_VERSION, reauthToken: token, expiresAt: new Date(claims.expiresAt).toISOString() };
  }

  /** Single-use check of a re-auth token against the calling session. */
  consumeReauthToken(principal: Principal, token: string | undefined): boolean {
    if (!token) return false;
    return this.deps.approvalTokens.consume(token, {
      approvalId: principal.session.idHash,
      userId: principal.userId,
      action: "auth.reauth",
    }).ok;
  }

  /** Re-read from the store: `markReauth` happened after the principal was created. */
  reauthAt(principal: Principal): number {
    return this.deps.sessions.get(principal.sessionId, { touch: false })?.reauthAt ?? principal.session.reauthAt;
  }

  reauthFresh(principal: Principal): boolean {
    const session = this.deps.sessions.get(principal.sessionId, { touch: false });
    return session ? hasFreshReauth(session, this.now(), this.deps.config.auth.reauthWindowMinutes * 60_000) : false;
  }

  sessionResponse(principal: Principal | null, freshnessAsOf: string): SessionResponse {
    if (!principal) {
      return {
        contractVersion: CONTRACT_VERSION,
        data: { authenticated: false, user: null, role: null, csrfToken: null, expiresAt: null, reauthUntil: null },
        freshness: { state: "fresh", asOf: freshnessAsOf },
      };
    }
    const session = this.deps.sessions.get(principal.sessionId, { touch: false }) ?? principal.session;
    const windowMs = this.deps.config.auth.reauthWindowMinutes * 60_000;
    const reauthUntil = hasFreshReauth(session, this.now(), windowMs) ? new Date(session.reauthAt + windowMs).toISOString() : null;
    return {
      contractVersion: CONTRACT_VERSION,
      data: {
        authenticated: true,
        user: { id: principal.userId, displayName: principal.displayName, role: principal.role },
        role: principal.role,
        csrfToken: this.csrfTokenFor(principal),
        expiresAt: new Date(session.expiresAt).toISOString(),
        reauthUntil,
      },
      freshness: { state: "fresh", asOf: freshnessAsOf },
    };
  }
}
