import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
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
  hashPassword,
  isRole,
  isLoopbackHost,
  issueCsrfToken,
  parseCookies,
  serializeCsrfCookie,
  serializeSessionCookie,
  verifyCsrfToken,
  verifyPassword,
  type Role,
  type Session,
  type SessionStore,
} from "@friday/auth";
import { parseSecretRef, resolveSecret, type FridayConfig } from "@friday/config";
import { CONTRACT_VERSION, type ReauthResponse, type SessionResponse } from "@friday/sdk";
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
  config: FridayConfig;
  sessions: SessionStore;
  csrfKey: Buffer;
  approvalTokens: ApprovalTokenService;
  limiter: LoginRateLimiter;
  env: NodeJS.ProcessEnv;
  displayName: () => string;
  ownerUsername?: () => string;
  setOwnerIdentity?: (username: string, displayName: string) => void;
  localLoginRequired?: () => boolean;
  now?: () => number;
}

/** Deterministic `usr_` ids (contract: `^usr_[0-9A-Za-z]{26}$`) derived from a stable label. */
export function stableUserId(label: string): string {
  return `usr_${createHash("sha256").update(`friday-user:${label}`).digest("hex").slice(0, 26).toUpperCase()}`;
}

const OWNER_USER_ID = stableUserId("owner");
const LOCAL_AUTO_USER_ID = stableUserId("local-auto-owner");
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Documented password of the dev auth mode; required for re-authentication (login accepts any non-empty password). */
export const DEV_PASSWORD = "dev";

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

/** Sessions, CSRF, login throttling and re-authentication on top of `@friday/auth` (SECURITY.md §3). */
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

  get localAutoLogin(): boolean {
    return !this.devMode && !this.deps.config.server.allowRemote &&
      isLoopbackHost(this.deps.config.server.host) && this.deps.localLoginRequired?.() === false;
  }

  /** Resolves the principal from the `Cookie` header; refreshes the sliding idle timeout. */
  authenticate(cookieHeader: string | undefined): Principal | null {
    const sessionId = parseCookies(cookieHeader)[SESSION_COOKIE];
    if (!sessionId) return null;
    const session = this.deps.sessions.get(sessionId);
    if (!session) return null;
    if (session.userId === LOCAL_AUTO_USER_ID && !this.localAutoLogin) return null;
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

  private cookiesFor(sessionId: string, rememberMe = false): string[] {
    const options = { secureCookies: this.deps.config.auth.secureCookies, maxAgeSeconds: rememberMe ? REMEMBER_TTL_MS / 1000 : this.deps.config.auth.sessionTtlMinutes * 60 };
    return [serializeSessionCookie(sessionId, options), serializeCsrfCookie(issueCsrfToken(this.deps.csrfKey, sessionId), options)];
  }

  clearCookies(): string[] {
    const secure = this.deps.config.auth.secureCookies;
    return [clearSessionCookie(secure), clearCsrfCookie(secure)];
  }

  private createSession(userId: string, role: Role, rememberMe = false): { sessionId: string; session: Session } {
    const { sessionId, session } = this.deps.sessions.create({
      userId,
      role,
      ttlMs: rememberMe ? REMEMBER_TTL_MS : this.deps.config.auth.sessionTtlMinutes * 60_000,
      idleTimeoutMs: rememberMe ? REMEMBER_TTL_MS : this.deps.config.auth.idleTimeoutMinutes * 60_000,
    });
    return { sessionId, session };
  }

  /** Dev auth: a session for `dev-<role>` is issued without credentials (mock data and loopback only). */
  issueDevSession(role: Role): { principal: Principal } & CookieSet {
    assertDevAuthAllowed({ dataMode: this.deps.config.dataMode, host: this.deps.config.server.host });
    const { sessionId, session } = this.createSession(DEV_USER_IDS[role], role);
    return { principal: this.principalOf(sessionId, session), setCookie: this.cookiesFor(sessionId) };
  }

  issueLocalSession(): { principal: Principal } & CookieSet {
    if (!this.localAutoLogin) throw new Error("Local automatic login is disabled");
    const { sessionId, session } = this.createSession(LOCAL_AUTO_USER_ID, "owner");
    return { principal: this.principalOf(sessionId, session), setCookie: this.cookiesFor(sessionId) };
  }

  private async setupOwner(username: string, displayName: string | undefined, password: string): Promise<void> {
    if (this.deps.config.server.allowRemote || !isLoopbackHost(this.deps.config.server.host)) {
      throw new ApiError({ code: "FORBIDDEN", message: "Die Ersteinrichtung ist nur am lokalen Rechner möglich." });
    }
    const name = username.trim();
    const display = displayName?.trim() ?? "";
    if (!/^[A-Za-z0-9._-]{2,32}$/.test(name) || display.length < 1 || display.length > 80 || password.length < 12) {
      throw new ApiError({ code: "VALIDATION_FAILED", message: "Benutzername, Anzeigename oder Passwort sind ungültig. Das Passwort braucht mindestens 12 Zeichen." });
    }
    const ref = parseSecretRef(this.deps.config.auth.ownerPasswordHash.ref);
    if (ref?.scheme !== "file") throw new ApiError({ code: "VALIDATION_FAILED", message: "Für die Ersteinrichtung ist ein lokaler Passwort-Hash-Dateipfad erforderlich." });
    const hash = await hashPassword(password);
    if (this.ownerPasswordConfigured() || existsSync(ref.name)) throw new ApiError({ code: "CONFLICT", message: "Das Besitzerkonto wurde bereits eingerichtet." });
    mkdirSync(dirname(ref.name), { recursive: true, mode: 0o700 });
    this.deps.setOwnerIdentity?.(name, display);
    try {
      writeFileSync(ref.name, hash, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ApiError({ code: "CONFLICT", message: "Das Besitzerkonto wurde bereits eingerichtet." });
      throw error;
    }
    if (process.platform === "win32") {
      const account = this.deps.env.USERNAME ?? process.env.USERNAME;
      const acl = account ? spawnSync("icacls.exe", [ref.name, "/inheritance:r", "/grant:r", `${account}:(R,W)`, "/grant:r", "SYSTEM:(R)"], { windowsHide: true }) : null;
      if (acl?.status !== 0) {
        unlinkSync(ref.name);
        throw new ApiError({ code: "VALIDATION_FAILED", message: "Die Zugriffsrechte für den Passwort-Hash konnten nicht gesetzt werden." });
      }
    } else {
      chmodSync(ref.name, 0o600);
    }
  }

  async login(username: string, password: string, ip: string, rememberMe = false, displayName?: string): Promise<{ principal: Principal } & CookieSet> {
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
    if (!this.ownerPasswordConfigured()) {
      try {
        await this.setupOwner(username, displayName, password);
      } catch (error) {
        this.deps.limiter.recordFailure(username, ip);
        throw error;
      }
    }
    const hash = this.ownerHash();
    const isOwner = username.trim().toLowerCase() === (this.deps.ownerUsername?.() ?? this.deps.config.auth.ownerUsername).toLowerCase();
    // Unknown user and wrong password take the same path (verifyPassword burns one scrypt computation for a missing hash).
    const ok = await verifyPassword(password, isOwner ? hash : undefined);
    if (!ok) {
      this.deps.limiter.recordFailure(username, ip);
      throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung fehlgeschlagen." });
    }
    this.deps.limiter.recordSuccess(username, ip);
    const { sessionId, session } = this.createSession(OWNER_USER_ID, "owner", rememberMe);
    return { principal: this.principalOf(sessionId, session), setCookie: this.cookiesFor(sessionId, rememberMe) };
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
    } else if (password !== DEV_PASSWORD) {
      // Dev login accepts any non-empty password (convenience), but re-auth checks the documented dev password so the
      // wrong-password path stays testable without hash auth.
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
        data: { authenticated: false, setupRequired: !this.devMode && !this.ownerPasswordConfigured(), user: null, role: null, csrfToken: null, expiresAt: null, reauthUntil: null },
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
        setupRequired: false,
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
