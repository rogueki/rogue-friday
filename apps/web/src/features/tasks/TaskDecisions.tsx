"use client";

import type { Task } from "@jarvis/sdk";
import { Button, TagPill } from "@jarvis/ui";
import { Check, ExternalLink, Eye, MessageSquareReply } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PanelFrame, type PanelState } from "@/components/PanelFrame";
import { useT, type MessageKey } from "@/i18n";
import { useTasks } from "@/lib/api/domains/tasks";
import { ProvideInputDialog } from "./ProvideInputDialog";
import { StatusChip } from "./TaskCard";
import { PRIORITY_TONE, decisionKind, type DecisionKind } from "./model";
import { DataOrigin, GatedButton, useDateFormatter } from "./moduleKit";
import { useTaskActionStates, useTaskCommands } from "./useTaskCommands";
import "./tasks.css";

function DecisionCard({ task, kind, onOpen }: { task: Task; kind: DecisionKind; onOpen: (task: Task) => void }) {
  const { t } = useT();
  const router = useRouter();
  const format = useDateFormatter();
  const commands = useTaskCommands();
  const states = useTaskActionStates(task);
  const [answering, setAnswering] = useState(false);
  const blocker = task.blockers.find((candidate) => candidate.kind === (kind === "approval" ? "approval" : "input_needed"));
  const approvalId = blocker?.refId ?? task.approvalIds[0];
  return (
    <article className="jv-card tk-decision" data-kind={kind} aria-label={task.title}>
      <div className="tk-card__top">
        <TagPill tone={PRIORITY_TONE[task.priority]} title={t(`priority.${task.priority}` as MessageKey)}>
          {task.priority}
        </TagPill>
        <button type="button" className="tk-card__title" onClick={() => onOpen(task)}>
          {task.title}
        </button>
        <StatusChip status={task.status} />
      </div>
      <p className="tk-decision__why">{blocker?.description ?? t(`tasks.decisions.why.${kind}` as MessageKey)}</p>
      <div className="tk-card__facts">
        <span>{task.agentName ?? t("tasks.card.unassigned")}</span>
        <span>{t("tasks.decisions.waiting", { time: format.relative(blocker?.since ?? task.lastActivityAt) })}</span>
      </div>
      <div className="tk-actions">
        {kind === "review" ? (
          <GatedButton size="sm" variant="primary" icon={<Check size={14} />} gate={states.approveResult.gate} blockedReason={states.approveResult.blockedReason} disabled={commands.pending} onClick={() => commands.approveResult(task)}>
            {t("tasks.action.approveResult")}
          </GatedButton>
        ) : kind === "input" ? (
          <GatedButton size="sm" variant="primary" icon={<MessageSquareReply size={14} />} gate={states.input.gate} blockedReason={states.input.blockedReason} onClick={() => setAnswering(true)}>
            {t("tasks.decisions.provideInput")}
          </GatedButton>
        ) : (
          <Button size="sm" variant="primary" icon={<ExternalLink size={14} />} onClick={() => router.push(approvalId ? `/approvals?approval=${encodeURIComponent(approvalId)}` : "/approvals")}>
            {t("tasks.decisions.openApproval")}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<Eye size={14} />} onClick={() => onOpen(task)}>
          {t("tasks.decisions.details")}
        </Button>
      </div>
      {kind === "input" && answering ? <ProvideInputDialog task={task} open onOpenChange={setAnswering} /> : null}
    </article>
  );
}

/** "Meine Entscheidungen": results to review and tasks that wait for an approval or for input (PLAN §28.1). */
export function TaskDecisions({ onOpen }: { onOpen: (task: Task) => void }) {
  const { t } = useT();
  const review = useTasks({ status: ["review"], limit: 100, sort: "-updatedAt" });
  const waiting = useTasks({ status: ["waiting", "running", "ready"], limit: 100, sort: "-updatedAt" });

  const cards = useMemo(() => {
    const result: { task: Task; kind: DecisionKind }[] = [];
    for (const task of [...(review.data?.items ?? []), ...(waiting.data?.items ?? [])]) {
      const kind = decisionKind(task);
      if (kind && !result.some((entry) => entry.task.id === task.id)) result.push({ task, kind });
    }
    const order: Record<DecisionKind, number> = { approval: 0, review: 1, input: 2 };
    return result.sort((a, b) => order[a.kind] - order[b.kind]);
  }, [review.data, waiting.data]);

  const error = review.error ?? waiting.error;
  const pending = review.isPending || waiting.isPending;
  const state: PanelState = pending
    ? { kind: "loading" }
    : error && cards.length === 0
      ? { kind: "error", error, onRetry: () => void Promise.all([review.refetch(), waiting.refetch()]) }
      : cards.length === 0
        ? { kind: "empty", title: t("tasks.decisions.empty"), description: t("tasks.decisions.emptyHint") }
        : { kind: "ready", freshness: review.data?.freshness, onRefresh: () => void Promise.all([review.refetch(), waiting.refetch()]) };

  return (
    <PanelFrame state={state} title={t("tasks.decisions.title")} subtitle={t("tasks.decisions.subtitle")} actions={<DataOrigin sources={review.data?.sources} freshness={review.data?.freshness} />} className="tk-decisions-panel" skeletonRows={3}>
      <div className="tk-decisions">
        {(["approval", "review", "input"] as const).map((kind) => {
          const group = cards.filter((entry) => entry.kind === kind);
          if (group.length === 0) return null;
          return (
            <section key={kind} aria-label={t(`tasks.decisions.group.${kind}` as MessageKey)}>
              <h3 className="tk-tab__h">
                {t(`tasks.decisions.group.${kind}` as MessageKey)} <span className="tk-muted">({group.length})</span>
              </h3>
              <div className="tk-decisions__grid">
                {group.map(({ task }) => (
                  <DecisionCard key={task.id} task={task} kind={kind} onOpen={onOpen} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </PanelFrame>
  );
}
