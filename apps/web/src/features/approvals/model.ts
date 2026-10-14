import type { Approval, ApprovalImpact, ApprovalStatus, ApprovalType, RequiredAuth, RiskTier } from "@jarvis/sdk";
import { isJarvisApiError } from "@jarvis/sdk";
import type { Tone } from "@jarvis/ui";

export const APPROVAL_TYPES: readonly ApprovalType[] = ["send_email", "change_event", "send_message", "delete_file", "order", "payment", "contract", "system_change"];
export const APPROVAL_STATUSES: readonly ApprovalStatus[] = ["pending", "approved", "executed", "rejected", "expired", "cancelled", "failed"];
export const RISK_TIERS: readonly RiskTier[] = [1, 2, 3];

export const TIER_TONE: Record<RiskTier, Tone> = { 1: "green", 2: "amber", 3: "red" };
export const AUTH_TONE: Record<RequiredAuth, Tone> = { none: "muted", confirm: "amber", reauth: "red" };
export const IMPACT_TONE: Record<NonNullable<ApprovalImpact["severity"]> | "none", Tone> = { info: "cyan", warning: "amber", error: "red", critical: "red", none: "muted" };

export const STATUS_TONE: Record<ApprovalStatus, Tone> = {
  pending: "amber",
  approved: "green",
  executed: "green",
  rejected: "red",
  expired: "muted",
  cancelled: "muted",
  failed: "red",
};

export function expiryMs(approval: Pick<Approval, "expiresAt">, now: Date): number | null {
  if (!approval.expiresAt) return null;
  const at = Date.parse(approval.expiresAt);
  return Number.isNaN(at) ? null : at - now.getTime();
}

/** Pending on paper, but past its expiry: the server will refuse it, so the UI does not offer a decision. */
export function isExpired(approval: Pick<Approval, "status" | "expiresAt">, now: Date): boolean {
  if (approval.status === "expired") return true;
  const remaining = expiryMs(approval, now);
  return approval.status === "pending" && remaining !== null && remaining <= 0;
}

export const isDecidable = (approval: Pick<Approval, "status" | "expiresAt">, now: Date): boolean => approval.status === "pending" && !isExpired(approval, now);

/** Tier 3 and `requiredAuth: reauth` need the password again (POST /auth/reauth); tier 3 is never decided by voice. */
export const needsReauth = (approval: Pick<Approval, "riskTier" | "requiredAuth">): boolean => approval.riskTier === 3 || approval.requiredAuth === "reauth";
export const needsConfirmation = (approval: Pick<Approval, "riskTier" | "requiredAuth">): boolean => approval.riskTier >= 2 || approval.requiredAuth !== "none";

export type DecisionFailure =
  | { kind: "token-expired" }
  | { kind: "token-invalid" }
  | { kind: "token-missing" }
  | { kind: "reauth-required" }
  | { kind: "wrong-password" }
  | { kind: "conflict"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "other"; message: string; correlationId?: string };

/** Classifies an error of the approve flow so the UI can answer in plain German and refetch where that helps. */
export function classifyDecisionError(error: unknown, phase: "reauth" | "approve"): DecisionFailure {
  if (!isJarvisApiError(error)) return { kind: "other", message: error instanceof Error ? error.message : String(error) };
  const reason = typeof error.details.reason === "string" ? error.details.reason : undefined;
  switch (error.code) {
    case "APPROVAL_REQUIRED":
      if (reason === "expired") return { kind: "token-expired" };
      if (reason === "missing_approval_token") return { kind: "token-missing" };
      return { kind: "token-invalid" };
    case "REAUTH_REQUIRED":
      return { kind: "reauth-required" };
    case "UNAUTHENTICATED":
      return phase === "reauth" ? { kind: "wrong-password" } : { kind: "other", message: error.message, correlationId: error.correlationId };
    case "CONFLICT":
      return { kind: "conflict", message: error.message };
    case "FORBIDDEN":
      return { kind: "forbidden", message: error.message };
    case "RATE_LIMITED":
      return { kind: "rate-limited", message: error.message };
    default:
      return { kind: "other", message: error.message, correlationId: error.correlationId };
  }
}
