import { CONTRACT_VERSION, type ActionResult, type LoginRequest, type ReauthRequest, type ReauthResponse, type Role, type Session } from "@friday/sdk";
import { MockApiError } from "../../core/errors";
import { clone } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, owner: 2 };

/**
 * Mock session handling. The mock owner is signed in by default so a standalone web app works immediately;
 * `login` accepts any non-empty credentials (no real secret is ever checked or stored).
 */
export class AuthService {
  constructor(private readonly w: MockWorld) {}

  getSession(): Session {
    const session = this.w.state.session;
    if (!session.authenticated) return { authenticated: false, user: null, role: null, csrfToken: null, expiresAt: null, reauthUntil: null };
    return {
      authenticated: true,
      user: { id: session.userId, displayName: session.displayName, role: session.role },
      role: session.role,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      reauthUntil: session.reauthUntil,
    };
  }

  login(request: LoginRequest): Session {
    this.w.validate("LoginRequest", request);
    const session = this.w.state.session;
    session.authenticated = true;
    session.csrfToken = this.w.id("csrf");
    session.expiresAt = new Date(this.w.nowMs() + this.w.state.settings.security.sessionTimeoutMinutes * 60_000).toISOString();
    this.w.recordAudit({ category: "security", action: "auth.login", correlationId: this.w.correlationId(), adapterId: "mock-audit", actor: this.w.defaultActor() });
    return this.getSession();
  }

  logout(ctx?: OpContext): ActionResult {
    const session = this.w.state.session;
    session.authenticated = false;
    session.reauthUntil = null;
    this.w.state.reauthTokens = [];
    const correlationId = this.w.correlationId(ctx);
    const audit = this.w.recordAudit({ category: "security", action: "auth.logout", correlationId, adapterId: "mock-audit", actor: this.w.defaultActor() });
    return { contractVersion: CONTRACT_VERSION, accepted: true, status: "completed", correlationId, auditEventId: audit.id, message: "Abgemeldet." };
  }

  reauth(request: ReauthRequest, ctx?: OpContext): ReauthResponse {
    this.w.validate("ReauthRequest", request);
    if (!this.w.state.session.authenticated) throw new MockApiError({ code: "UNAUTHENTICATED", message: "Bitte zuerst anmelden." });
    const windowMs = this.w.state.settings.security.reauthWindowMinutes * 60_000;
    const expiresAt = new Date(this.w.nowMs() + windowMs).toISOString();
    const token = this.w.id("reauth");
    this.w.state.reauthTokens.push({ token, expiresAt });
    this.w.state.session.reauthUntil = expiresAt;
    this.w.recordAudit({ category: "security", action: "auth.reauth", correlationId: this.w.correlationId(ctx), adapterId: "mock-audit", actor: this.w.defaultActor() });
    return { contractVersion: CONTRACT_VERSION, reauthToken: token, expiresAt };
  }

  /** Validates and consumes a short-lived re-auth token (single use). */
  consumeReauth(token: string | undefined): boolean {
    if (!token) return false;
    const now = this.w.nowMs();
    const index = this.w.state.reauthTokens.findIndex((entry) => entry.token === token && Date.parse(entry.expiresAt) > now);
    if (index < 0) return false;
    this.w.state.reauthTokens.splice(index, 1);
    return true;
  }

  /** Throws UNAUTHENTICATED / FORBIDDEN when the session does not satisfy the route's minimum role. */
  requireRole(minimum: Role | "none"): void {
    if (minimum === "none") return;
    const session = this.w.state.session;
    if (!session.authenticated) throw new MockApiError({ code: "UNAUTHENTICATED", message: "Nicht angemeldet." });
    if (ROLE_RANK[session.role] < ROLE_RANK[minimum]) {
      throw new MockApiError({ code: "FORBIDDEN", message: `Für diese Aktion ist die Rolle ${minimum} erforderlich.`, details: { required: minimum, actual: session.role } });
    }
  }

  setRole(role: Role): void {
    this.w.state.session.role = role;
  }

  snapshotSession(): Session {
    return clone(this.getSession());
  }
}
