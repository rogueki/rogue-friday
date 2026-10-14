"use client";

import type { Approval, Freshness } from "@jarvis/sdk";
import { isJarvisApiError } from "@jarvis/sdk";
import { Button, Drawer, EmptyState, ErrorState, Skeleton, StatusDot, TagPill, cx, useToast } from "@jarvis/ui";
import { Check, ExternalLink, MessageSquareQuote, Pencil, ShieldAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { entityRoute } from "@/features/tasks/model";
import { DataOrigin, FactList, GatedButton, useDateFormatter } from "@/features/tasks/moduleKit";
import { useT, type MessageKey } from "@/i18n";
import { useApproval, useApprovalToken } from "@/lib/api/domains/approvals";
import { useCapabilityState } from "@/lib/capabilities";
import { ApprovalContextDialog, ApprovalDecisionDialog, ApprovalRejectDialog, failureMessage } from "./ApprovalDialogs";
import { AUTH_TONE, IMPACT_TONE, STATUS_TONE, TIER_TONE, expiryMs, isDecidable, isExpired, needsConfirmation } from "./model";
import { useApprovalDecision } from "./useApprovalDecision";
import "./approvals.css";

export interface ApprovalDrawerProps {
  approvalId: string | null;
  agentNames: ReadonlyMap<string, string>;
  onClose: () => void;
}

function Preview({ approval }: { approval: Approval }) {
  const { t } = useT();
  const { preview } = approval;
  return (
    <section className="ap-preview" aria-label={t("approvals.field.preview")}>
      <div className="ap-preview__head">
        <TagPill tone="blue">{t(`approvals.preview.${preview.kind}` as MessageKey)}</TagPill>
        <strong className="ap-preview__title">{preview.title}</strong>
      </div>
      {/* Plain text only: the preview is produced by an agent and must never be interpreted as markup. */}
      <pre className="ap-preview__body">{preview.body}</pre>
      {preview.fields && preview.fields.length > 0 ? (
        <dl className="ap-preview__fields">
          {preview.fields.map((field, index) => (
            <div key={`${field.label}-${index}`}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function ApprovalBody({ approval, agentNames, freshness }: { approval: Approval; agentNames: ReadonlyMap<string, string>; freshness?: Freshness }) {
  const { t } = useT();
  const router = useRouter();
  const format = useDateFormatter();
  const expired = isExpired(approval, format.now);
  const status = expired && approval.status === "pending" ? "expired" : approval.status;
  const remaining = expiryMs(approval, format.now);
  const sourceRoute = approval.sourceRef ? entityRoute(approval.sourceRef) : null;
  return (
    <div className="ap-detail">
      <DataOrigin sources={[approval.source]} freshness={freshness} />
      <div className="ap-detail__statement">
        <ShieldAlert size={18} strokeWidth={1.5} aria-hidden="true" />
        <p>
          <strong>{t("approvals.approve.youAre")}</strong> {approval.action}
        </p>
      </div>
      <div className="ap-detail__tags">
        <TagPill tone={TIER_TONE[approval.riskTier]}>{t(`approvals.tier.${approval.riskTier}` as MessageKey)}</TagPill>
        <TagPill tone="blue">{t(`approvals.type.${approval.type}` as MessageKey)}</TagPill>
        <span className={cx("ap-card__status", `jv-tone-${STATUS_TONE[status]}`)}>
          <StatusDot tone={STATUS_TONE[status]} pulse={status === "pending"} />
          {t(`approvals.status.${status}` as MessageKey)}
        </span>
      </div>
      <FactList
        items={[
          {
            label: t("approvals.field.agent"),
            value: approval.agentId ? (
              <Button size="sm" variant="ghost" onClick={() => router.push(`/agents?agent=${encodeURIComponent(approval.agentId ?? "")}`)}>
                {agentNames.get(approval.agentId) ?? approval.agentId}
              </Button>
            ) : (
              "—"
            ),
          },
          {
            label: t("approvals.field.task"),
            value: approval.taskId ? (
              <Button size="sm" variant="ghost" onClick={() => router.push(`/tasks?task=${encodeURIComponent(approval.taskId ?? "")}`)}>
                {approval.taskId}
              </Button>
            ) : (
              "—"
            ),
          },
          {
            label: t("approvals.field.auth"),
            value: <TagPill tone={AUTH_TONE[approval.requiredAuth]}>{t(`approvals.auth.${approval.requiredAuth}` as MessageKey)}</TagPill>,
          },
          {
            label: t("approvals.field.expires"),
            value: approval.expiresAt ? (
              <span className={cx(status === "pending" && remaining !== null && remaining < 5 * 60_000 && "jv-tone-red")}>
                {format.dateTime(approval.expiresAt)} · {expired ? t("approvals.expired") : t("approvals.expiresIn", { time: format.relative(approval.expiresAt) })}
              </span>
            ) : (
              t("approvals.noExpiry")
            ),
          },
          { label: t("approvals.field.created"), value: format.dateTime(approval.createdAt) },
          { label: t("approvals.field.version"), value: <code>{approval.version}</code> },
        ]}
      />
      <section className="ap-detail__block" aria-label={t("approvals.field.rationale")}>
        <h3 className="tk-tab__h">{t("approvals.field.rationale")}</h3>
        <p className="tk-text">{approval.rationale}</p>
      </section>
      <section className="ap-detail__block" aria-label={t("approvals.field.impacts")}>
        <h3 className="tk-tab__h">{t("approvals.field.impacts")}</h3>
        {approval.impacts.length === 0 ? (
          <p className="tk-muted">{t("approvals.noImpacts")}</p>
        ) : (
          <ul className="tk-list tk-list--flush">
            {approval.impacts.map((impact) => (
              <li key={`${impact.kind}-${impact.description}`} className="tk-list__item tk-list__item--row">
                <TagPill tone={IMPACT_TONE[impact.severity ?? "none"]}>{t(`approvals.impact.${impact.kind}` as MessageKey)}</TagPill>
                <span className="tk-list__title">{impact.description}</span>
                {impact.severity ? <span className="tk-list__aside">{t(`activity.severity.${impact.severity}` as MessageKey)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Preview approval={approval} />
      {approval.status !== "pending" ? (
        <section className="ap-detail__block" aria-label={t("approvals.field.decision")}>
          <h3 className="tk-tab__h">{t("approvals.field.decision")}</h3>
          <FactList
            items={[
              { label: t("approvals.field.decidedAt"), value: format.dateTime(approval.decidedAt) },
              { label: t("approvals.field.decidedBy"), value: approval.decidedBy ? (approval.decidedBy.name ?? approval.decidedBy.id) : "—" },
              ...(approval.decisionComment ? [{ label: t("approvals.field.comment"), value: approval.decisionComment, wide: true }] : []),
              ...(approval.executionResult ? [{ label: t("approvals.field.executionResult"), value: approval.executionResult, wide: true }] : []),
            ]}
          />
        </section>
      ) : null}
      {sourceRoute ? (
        <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => router.push(sourceRoute)}>
          {t("approvals.openSource")}: {approval.sourceRef?.label ?? approval.sourceRef?.id}
        </Button>
      ) : null}
    </div>
  );
}

/** Detail drawer of `/approvals?approval=…`: all fields of §32.2 and the five actions of §32.4, capability-gated. */
export function ApprovalDrawer({ approvalId, agentNames, onClose }: ApprovalDrawerProps) {
  const { t } = useT();
  const router = useRouter();
  const format = useDateFormatter();
  const query = useApproval(approvalId);
  const approval = query.data?.data;
  const decidable = approval ? isDecidable(approval, format.now) : false;
  const decideGate = useCapabilityState("approvals", "decide");
  // Opening the details of a pending approval fetches it again for the approval token (X-Approval-Token, PLAN §32.5);
  // without the decide capability nobody could use it, so none is requested.
  const tokenQuery = useApprovalToken(approvalId, decidable && decideGate === "available");
  const editGate = useCapabilityState("approvals", "editBeforeApprove");
  const contextGate = useCapabilityState("approvals", "requestContext");
  const [dialog, setDialog] = useState<"approve" | "edit" | "reject" | "context" | null>(null);
  const decision = useApprovalDecision();
  const { toast } = useToast();

  const expired = approval ? isExpired(approval, format.now) : false;
  const notPending = approval && approval.status !== "pending" ? t("approvals.reason.decided") : undefined;
  const expiredReason = expired ? t("approvals.reason.expired") : undefined;
  const blocked = notPending ?? expiredReason;

  const approveDirect = (): void => {
    if (!approval) return;
    if (needsConfirmation(approval)) {
      setDialog("approve");
      return;
    }
    // Tier 1 without required authentication: one click decides, the flow is the same (token, If-Match, idempotency key).
    decision.newIntent();
    void decision.decide(approval, {}).then((result) =>
      result.ok
        ? toast({ title: t("approvals.toast.approved"), description: approval.action, tone: "green", duration: 5000 })
        : toast({ title: t("approvals.toast.failed"), description: failureMessage(result.failure, t), tone: "red", duration: 9000 }),
    );
  };

  let body;
  if (!approvalId) body = null;
  else if (query.isPending) body = <Skeleton variant="block" height={260} label={t("common.loading")} />;
  else if (query.isError) {
    body =
      isJarvisApiError(query.error) && query.error.code === "NOT_FOUND" ? (
        <EmptyState compact title={t("approvals.drawer.notFound")} description={t("approvals.drawer.notFoundHint")} />
      ) : (
        <ErrorState compact title={t("common.loadError")} description={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} retryLabel={t("common.retry")} />
      );
  } else if (approval) body = <ApprovalBody approval={approval} agentNames={agentNames} freshness={query.data?.freshness} />;

  const footer = approval ? (
    <div className="ap-actions" role="group" aria-label={t("approvals.actions.label")}>
      <GatedButton size="sm" variant="primary" icon={<Check size={14} />} gate={decideGate} blockedReason={blocked} disabled={decision.pending} onClick={approveDirect}>
        {t("approvals.action.approve")}
      </GatedButton>
      <GatedButton size="sm" variant="danger" icon={<X size={14} />} gate={decideGate} blockedReason={blocked} onClick={() => setDialog("reject")}>
        {t("approvals.action.reject")}
      </GatedButton>
      <GatedButton size="sm" variant="ghost" icon={<Pencil size={14} />} gate={editGate} blockedReason={blocked ?? (approval.editable ? undefined : t("approvals.reason.notEditable"))} onClick={() => setDialog("edit")}>
        {t("approvals.action.edit")}
      </GatedButton>
      <GatedButton size="sm" variant="ghost" icon={<MessageSquareQuote size={14} />} gate={contextGate} blockedReason={blocked} onClick={() => setDialog("context")}>
        {t("approvals.action.context")}
      </GatedButton>
      <Button
        size="sm"
        variant="ghost"
        icon={<ExternalLink size={14} />}
        disabled={!approval.sourceRef || !entityRoute(approval.sourceRef)}
        title={!approval.sourceRef ? t("approvals.reason.noSource") : undefined}
        onClick={() => {
          const route = approval.sourceRef ? entityRoute(approval.sourceRef) : null;
          if (route) router.push(route);
        }}
      >
        {t("approvals.action.source")}
      </Button>
    </div>
  ) : null;

  return (
    <>
      <Drawer
        open={approvalId !== null}
        onOpenChange={(open) => !open && onClose()}
        title={t("approvals.drawer.title")}
        subtitle={approval ? <code className="tk-muted">{approval.id}</code> : undefined}
        className="mod-drawer"
        width={640}
        closeLabel={t("common.close")}
        footer={footer}
      >
        {body}
        {approval && decidable && tokenQuery.isError ? (
          <p className="ap-error" role="status">
            {t("approvals.error.tokenUnavailable")}
          </p>
        ) : null}
      </Drawer>
      {approval ? (
        <>
          <ApprovalDecisionDialog approval={approval} mode="approve" open={dialog === "approve"} onOpenChange={(open) => !open && setDialog(null)} />
          <ApprovalDecisionDialog approval={approval} mode="edit" open={dialog === "edit"} onOpenChange={(open) => !open && setDialog(null)} />
          <ApprovalRejectDialog approval={approval} open={dialog === "reject"} onOpenChange={(open) => !open && setDialog(null)} />
          <ApprovalContextDialog approval={approval} open={dialog === "context"} onOpenChange={(open) => !open && setDialog(null)} />
        </>
      ) : null}
    </>
  );
}
