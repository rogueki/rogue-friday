import { sha256Hex } from "../core/sha256";
import type { MockWorld } from "../world/world";

/** Lifetime of a token on the world clock; the Control API uses the same 120 s (`DEFAULT_APPROVAL_TOKEN_TTL_MS`). */
export const MOCK_APPROVAL_TOKEN_TTL_MS = 120_000;

export type TokenCheck = "ok" | "missing" | "unknown" | "expired" | "mismatch";

interface Issued {
  approvalId: string;
  expiresAt: number;
}

/**
 * Approval tokens of the standalone mock (PLAN §32.5). Like the Control API, `GET /approvals/{id}` hands a short-lived,
 * single-use token out in the `X-Approval-Token` response header and `POST …/approve` refuses to run without it. The
 * tokens live next to the world (not in its state), so a world reset invalidates them like a server restart would.
 */
export class MockApprovalTokens {
  private static readonly byWorld = new WeakMap<MockWorld, MockApprovalTokens>();
  private readonly issued = new Map<string, Issued>();
  private counter = 0;

  static for(world: MockWorld): MockApprovalTokens {
    let tokens = MockApprovalTokens.byWorld.get(world);
    if (!tokens) {
      tokens = new MockApprovalTokens(world);
      MockApprovalTokens.byWorld.set(world, tokens);
    }
    return tokens;
  }

  private constructor(private readonly world: MockWorld) {}

  issue(approvalId: string): { token: string; expiresAt: string } {
    this.purge();
    this.counter += 1;
    const token = `mat_${sha256Hex(`${this.world.seed}:${approvalId}:${this.counter}`).slice(0, 32)}`;
    const expiresAt = this.world.nowMs() + MOCK_APPROVAL_TOKEN_TTL_MS;
    this.issued.set(token, { approvalId, expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Validates and burns the token; a token is valid exactly once and only for the approval it was issued for. */
  consume(token: string | null, approvalId: string): TokenCheck {
    if (!token) return "missing";
    const record = this.issued.get(token);
    if (!record) return "unknown";
    this.issued.delete(token);
    if (record.expiresAt <= this.world.nowMs()) return "expired";
    return record.approvalId === approvalId ? "ok" : "mismatch";
  }

  private purge(): void {
    const now = this.world.nowMs();
    for (const [token, record] of this.issued) if (record.expiresAt <= now) this.issued.delete(token);
  }
}
