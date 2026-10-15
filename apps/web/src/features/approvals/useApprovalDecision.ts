"use client";

import { createIdempotencyKey, type Approval, type ApprovalPreview } from "@friday/sdk";
import { useCallback, useRef } from "react";
import { useDecideApproval, useEnsureApprovalToken, useReauth, useRefreshApprovalToken } from "@/lib/api/domains/approvals";
import { classifyDecisionError, needsReauth, type DecisionFailure } from "./model";

export interface DecisionInput {
  comment?: string;
  /** Password for the re-authentication of tier-3 decisions. Never stored, only sent to POST /auth/reauth. */
  password?: string;
  /** "Edit then approve": the edited preview that is approved instead of the proposed one. */
  editedPreview?: ApprovalPreview;
}

export type DecisionResult = { ok: true; approval: Approval } | { ok: false; failure: DecisionFailure };

const TOKEN_RELATED: ReadonlySet<DecisionFailure["kind"]> = new Set(["token-expired", "token-invalid", "token-missing", "reauth-required", "conflict"]);

/**
 * The decision flow of PLAN §32.5 on the client:
 *  1. take the approval token that GET /approvals/{id} issued (refetch when missing, spent or about to expire),
 *  2. tier 3: password -> POST /auth/reauth -> single-use reauth token,
 *  3. POST approve with `X-Approval-Token`, `If-Match` (the version the user saw) and one Idempotency-Key per decision.
 * Nothing is optimistic. A failure is returned as a classified result so the UI can say what happened in German; after
 * every failure that may have consumed the token it is fetched again, so "try again" works.
 */
export function useApprovalDecision() {
  const ensureToken = useEnsureApprovalToken();
  const refreshToken = useRefreshApprovalToken();
  const reauth = useReauth();
  const approve = useDecideApproval("approve");
  const reject = useDecideApproval("reject");
  /** One key per decision (dialog session): a repeated submit replays the stored result instead of executing twice. */
  const intentKey = useRef<string | null>(null);

  const newIntent = useCallback(() => {
    intentKey.current = null;
  }, []);
  const keyFor = (): string => (intentKey.current ??= createIdempotencyKey());

  const decide = useCallback(
    async (approval: Approval, input: DecisionInput): Promise<DecisionResult> => {
      const key = keyFor();
      let token: Awaited<ReturnType<typeof ensureToken>>;
      try {
        token = await ensureToken(approval.id);
      } catch (error) {
        return { ok: false, failure: classifyDecisionError(error, "approve") };
      }

      let reauthToken: string | undefined;
      if (needsReauth(approval)) {
        try {
          reauthToken = (await reauth.mutateAsync({ password: input.password ?? "" })).reauthToken;
        } catch (error) {
          return { ok: false, failure: classifyDecisionError(error, "reauth") };
        }
      }

      try {
        const response = await approve.mutateAsync({
          id: approval.id,
          version: approval.version,
          approvalToken: token.token ?? undefined,
          idempotencyKey: key,
          body: {
            ...(input.comment ? { comment: input.comment } : {}),
            ...(reauthToken ? { reauthToken } : {}),
            ...(input.editedPreview ? { editedPreview: input.editedPreview } : {}),
          },
        });
        intentKey.current = null;
        return { ok: true, approval: response.data };
      } catch (error) {
        const failure = classifyDecisionError(error, "approve");
        if (TOKEN_RELATED.has(failure.kind)) {
          // The server may have consumed the token before it refused; get the next one (and the current approval) now.
          await refreshToken(approval.id).catch(() => undefined); // the next attempt fetches again and reports a real outage
        }
        return { ok: false, failure };
      }
    },
    [ensureToken, refreshToken, reauth, approve],
  );

  const rejectApproval = useCallback(
    async (approval: Approval, comment: string): Promise<DecisionResult> => {
      try {
        const response = await reject.mutateAsync({
          id: approval.id,
          version: approval.version,
          idempotencyKey: keyFor(),
          body: comment ? { comment } : {},
        });
        intentKey.current = null;
        return { ok: true, approval: response.data };
      } catch (error) {
        return { ok: false, failure: classifyDecisionError(error, "approve") };
      }
    },
    [reject],
  );

  return { decide, rejectApproval, newIntent, pending: approve.isPending || reauth.isPending || reject.isPending };
}
