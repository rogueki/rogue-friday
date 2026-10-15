"use client";

import type { ActivityEvent, ArtifactRef, ErrorDetail, Task } from "@friday/sdk";
import { ActivityRow, Button, ConfirmDialog, Drawer, EmptyState, ErrorState, Select, Skeleton, TagPill, Tabs, cx, type TabItem } from "@friday/ui";
import { isFridayApiError } from "@friday/sdk";
import { Ban, Check, CircleCheck, CircleDashed, CircleX, ExternalLink, Pause, Play, RotateCcw, ShieldCheck, SkipForward, Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { fallbackKindIcon, KIND_ICON, SEVERITY_TONE } from "@/features/activity/model";
import { useT, type MessageKey } from "@/i18n";
import { useActivity } from "@/lib/api/domains/activity";
import { useAgents } from "@/lib/api/domains/agents";
import { useApprovals } from "@/lib/api/domains/approvals";
import { useTask, useTaskAudit } from "@/lib/api/domains/tasks";
import { useCapability } from "@/lib/capabilities";
import { ProvideInputDialog } from "./ProvideInputDialog";
import { StatusChip, TaskProgress } from "./TaskCard";
import { PRIORITY_TONE, entityRoute, progressPercent } from "./model";
import { CopyButton, DataOrigin, FactList, GatedButton, useDateFormatter } from "./moduleKit";
import { useTaskActionStates, useTaskCommands } from "./useTaskCommands";
import "./tasks.css";

export const TASK_TABS = ["overview", "steps", "activity", "tools", "sources", "artifacts", "approvals", "errors", "audit"] as const;
export type TaskTab = (typeof TASK_TABS)[number];

const STEP_ICON = {
  pending: <CircleDashed size={14} strokeWidth={1.75} aria-hidden="true" />,
  running: <Loader size={14} strokeWidth={1.75} aria-hidden="true" />,
  done: <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" />,
  failed: <CircleX size={14} strokeWidth={1.75} aria-hidden="true" />,
  skipped: <SkipForward size={14} strokeWidth={1.75} aria-hidden="true" />,
} as const;
const STEP_TONE = { pending: "muted", running: "cyan", done: "green", failed: "red", skipped: "muted" } as const;

function TabEmpty({ title }: { title: string }) {
  return <EmptyState compact title={title} />;
}

function ErrorList({ errors }: { errors: readonly ErrorDetail[] }) {
  const { t } = useT();
  return (
    <ul className="tk-list">
      {errors.map((error, index) => (
        <li key={`${error.correlationId}-${index}`} className="tk-list__item">
          <div className="tk-list__head">
            <TagPill tone={SEVERITY_TONE[error.severity]}>{t(`activity.severity.${error.severity}` as MessageKey)}</TagPill>
            <span className="tk-list__title">{error.code}</span>
            <span className="tk-list__aside">{error.retryable ? t("tasks.errors.retryable") : t("tasks.errors.final")}</span>
          </div>
          <p className="tk-list__text">{error.message}</p>
          <div className="tk-list__foot">
            <code>{error.correlationId}</code>
            <CopyButton value={error.correlationId} label={t("tasks.copyCorrelation")} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function OverviewTab({ task, assignable }: { task: Task; assignable: boolean }) {
  const { t } = useT();
  const format = useDateFormatter();
  const agents = useAgents({ limit: 200 });
  const commands = useTaskCommands();
  const states = useTaskActionStates(task);
  const canAssign = states.assign.gate === "available" && !states.assign.blockedReason;
  const [answering, setAnswering] = useState(false);
  return (
    <div className="tk-tab">
      <FactList
        items={[
          { label: t("tasks.field.status"), value: <StatusChip status={task.status} /> },
          { label: t("tasks.field.priority"), value: <TagPill tone={PRIORITY_TONE[task.priority]}>{`${task.priority} · ${t(`priority.${task.priority}` as MessageKey)}`}</TagPill> },
          {
            label: t("tasks.field.agent"),
            value: assignable ? (
              <Select
                label={t("tasks.assign.label")}
                hideLabel
                value={task.agentId ?? ""}
                disabled={!canAssign}
                title={!canAssign ? (states.assign.blockedReason ?? t("tasks.kit.reason.readOnly")) : undefined}
                options={[
                  { value: "", label: t("tasks.card.unassigned") },
                  ...(task.agentId && !agents.data?.items.some((agent) => agent.id === task.agentId) ? [{ value: task.agentId, label: task.agentName ?? task.agentId }] : []),
                  ...(agents.data?.items ?? []).map((agent) => ({ value: agent.id, label: `${agent.name} · ${t(`agent.status.${agent.status}` as MessageKey)}` })),
                ]}
                onChange={(event) => commands.assign(task, event.target.value === "" ? null : event.target.value)}
              />
            ) : (
              (task.agentName ?? t("tasks.card.unassigned"))
            ),
          },
          { label: t("tasks.field.model"), value: task.model ?? "—" },
          { label: t("tasks.field.runtime"), value: format.duration(task.runtimeMs) },
          { label: t("tasks.field.started"), value: format.dateTime(task.startedAt) },
          { label: t("tasks.field.due"), value: format.dateTime(task.dueAt) },
          { label: t("tasks.field.eta"), value: format.dateTime(task.estimatedCompletionAt) },
          { label: t("tasks.field.lastActivity"), value: format.relative(task.lastActivityAt) },
          { label: t("tasks.field.createdBy"), value: task.createdBy.name ?? task.createdBy.id },
          { label: t("tasks.field.created"), value: format.dateTime(task.createdAt) },
          { label: t("tasks.field.version"), value: <code>{task.version}</code> },
        ]}
      />
      <div className="tk-tab__block">
        <h3 className="tk-tab__h">
          {t("tasks.field.progress")}
          {progressPercent(task) !== null ? ` · ${progressPercent(task)} %` : ""}
        </h3>
        {progressPercent(task) === null ? <p className="tk-muted">{t("tasks.card.progressUnknown")}</p> : null}
        <TaskProgress task={task} label={`${task.title}: ${t("tasks.card.progress")}`} />
      </div>
      {task.description ? (
        <div className="tk-tab__block">
          <h3 className="tk-tab__h">{t("tasks.field.description")}</h3>
          <p className="tk-text">{task.description}</p>
        </div>
      ) : null}
      {task.labels && task.labels.length > 0 ? (
        <div className="tk-tab__block">
          <h3 className="tk-tab__h">{t("tasks.field.labels")}</h3>
          <div className="tk-tags">
            {task.labels.map((label) => (
              <TagPill key={label} tone="muted">
                {label}
              </TagPill>
            ))}
          </div>
        </div>
      ) : null}
      {task.blockers.length > 0 ? (
        <div className="tk-tab__block">
          <h3 className="tk-tab__h">{t("tasks.field.blockers")}</h3>
          <ul className="tk-list">
            {task.blockers.map((blocker) => (
              <li key={blocker.id} className="tk-list__item">
                <div className="tk-list__head">
                  <TagPill tone="amber">{t(`tasks.blocker.${blocker.kind}` as MessageKey)}</TagPill>
                  {blocker.since ? <span className="tk-list__aside">{t("tasks.blocker.since", { time: format.relative(blocker.since) })}</span> : null}
                </div>
                <p className="tk-list__text">{blocker.description}</p>
                {blocker.kind === "input_needed" ? (
                  <GatedButton size="sm" variant="primary" gate={states.input.gate} onClick={() => setAnswering(true)}>
                    {t("tasks.decisions.provideInput")}
                  </GatedButton>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {answering ? <ProvideInputDialog task={task} open onOpenChange={setAnswering} /> : null}
    </div>
  );
}

function StepsTab({ task }: { task: Task }) {
  const { t } = useT();
  const format = useDateFormatter();
  if (task.steps.length === 0) return <TabEmpty title={t("tasks.steps.empty")} />;
  const steps = task.steps.slice().sort((a, b) => a.index - b.index);
  return (
    <ol className="tk-steps">
      {steps.map((step) => (
        <li key={step.id} className={cx("tk-steps__item", `jv-tone-${STEP_TONE[step.status]}`)} data-status={step.status}>
          <span className="tk-steps__icon">{STEP_ICON[step.status]}</span>
          <div className="tk-steps__main">
            <span className="tk-steps__title">{step.title}</span>
            <span className="tk-steps__state">{t(`tasks.step.${step.status}` as MessageKey)}</span>
            {step.detail ? <p className="tk-list__text">{step.detail}</p> : null}
            {step.startedAt || step.finishedAt ? (
              <span className="tk-muted">
                {step.startedAt ? format.time(step.startedAt) : "—"} – {step.finishedAt ? format.time(step.finishedAt) : "…"}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ActivityTab({ task }: { task: Task }) {
  const { t } = useT();
  const router = useRouter();
  const format = useDateFormatter();
  const query = useActivity({ taskId: task.id, limit: 50 });
  if (query.isPending) return <Skeleton variant="row" height={48} label={t("common.loading")} />;
  if (query.isError) return <ErrorState compact title={t("common.loadError")} onRetry={() => void query.refetch()} retryLabel={t("common.retry")} />;
  const items: ActivityEvent[] = query.data.items;
  if (items.length === 0) return <TabEmpty title={t("tasks.activity.empty")} />;
  return (
    <div className="tk-rows">
      {items.map((event) => (
        <ActivityRow
          key={event.id}
          icon={KIND_ICON[event.kind] ?? fallbackKindIcon}
          title={event.title}
          meta={event.summary ?? event.tool ?? undefined}
          tone={SEVERITY_TONE[event.severity]}
          tag={t(`activity.severity.${event.severity}` as MessageKey)}
          time={format.time(event.occurredAt)}
          onClick={() => router.push(`/activity?event=${encodeURIComponent(event.id)}`)}
        />
      ))}
    </div>
  );
}

function ToolsTab({ task }: { task: Task }) {
  const { t } = useT();
  const format = useDateFormatter();
  if (task.toolCalls.length === 0) return <TabEmpty title={t("tasks.tools.empty")} />;
  const tone = { running: "cyan", succeeded: "green", failed: "red" } as const;
  return (
    <ul className="tk-list">
      {task.toolCalls.map((call) => (
        <li key={call.id} className="tk-list__item">
          <div className="tk-list__head">
            <span className="tk-list__title tk-mono">{call.tool}</span>
            <TagPill tone={tone[call.status]}>{t(`tasks.tool.${call.status}` as MessageKey)}</TagPill>
            <span className="tk-list__aside">{format.duration(call.durationMs)}</span>
          </div>
          {call.summary ? <p className="tk-list__text">{call.summary}</p> : null}
          <div className="tk-list__foot">
            <span className="tk-muted">
              {format.dateTime(call.startedAt)}
              {call.adapterId ? ` · ${call.adapterId}` : ""}
            </span>
          </div>
          {call.error ? <p className="tk-list__text jv-tone-red tk-err">{call.error.message}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function SourcesTab({ task }: { task: Task }) {
  const { t } = useT();
  const router = useRouter();
  if (task.sourceRefs.length === 0) return <TabEmpty title={t("tasks.sources.empty")} />;
  return (
    <ul className="tk-list">
      {task.sourceRefs.map((ref) => {
        const route = entityRoute(ref);
        return (
          <li key={`${ref.type}-${ref.id}`} className="tk-list__item tk-list__item--row">
            <TagPill tone="teal">{t(`tasks.entity.${ref.type}` as MessageKey)}</TagPill>
            <span className="tk-list__title">{ref.label ?? ref.id}</span>
            {route ? (
              <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => router.push(route)}>
                {t("tasks.open")}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ArtifactsTab({ task }: { task: Task }) {
  const { t } = useT();
  const router = useRouter();
  const canOpenFiles = useCapability("files", "read");
  if (task.artifacts.length === 0) return <TabEmpty title={t("tasks.artifacts.empty")} />;
  const size = (artifact: ArtifactRef): string =>
    artifact.sizeBytes === undefined ? "" : artifact.sizeBytes >= 1_048_576 ? `${(artifact.sizeBytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(artifact.sizeBytes / 1024))} KB`;
  return (
    <ul className="tk-list">
      {task.artifacts.map((artifact) => {
        const reason = !artifact.fileId ? t("tasks.artifacts.noFile") : !canOpenFiles ? t("tasks.kit.reason.missing") : undefined;
        return (
          <li key={artifact.id} className="tk-list__item tk-list__item--row">
            <TagPill tone="blue">{t(`tasks.artifact.${artifact.kind}` as MessageKey)}</TagPill>
            <span className="tk-list__title">{artifact.name}</span>
            <span className="tk-muted">{size(artifact)}</span>
            <Button
              size="sm"
              variant="ghost"
              icon={<ExternalLink size={13} />}
              disabled={reason !== undefined}
              title={reason}
              onClick={() => artifact.fileId && router.push(`/files?file=${encodeURIComponent(artifact.fileId)}`)}
            >
              {t("tasks.artifacts.open")}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function ApprovalsTab({ task }: { task: Task }) {
  const { t } = useT();
  const router = useRouter();
  const format = useDateFormatter();
  const query = useApprovals({ taskId: task.id, limit: 50 });
  if (query.isPending) return <Skeleton variant="row" height={48} label={t("common.loading")} />;
  if (query.isError) return <ErrorState compact title={t("common.loadError")} onRetry={() => void query.refetch()} retryLabel={t("common.retry")} />;
  if (query.data.items.length === 0) return <TabEmpty title={t("tasks.approvals.empty")} />;
  return (
    <ul className="tk-list">
      {query.data.items.map((approval) => (
        <li key={approval.id} className="tk-list__item tk-list__item--row">
          <ShieldCheck size={16} strokeWidth={1.5} aria-hidden="true" />
          <span className="tk-list__title">{approval.action}</span>
          <TagPill tone={approval.status === "pending" ? "amber" : approval.status === "approved" || approval.status === "executed" ? "green" : "muted"}>
            {t(`approvals.status.${approval.status}` as MessageKey)}
          </TagPill>
          <span className="tk-muted">{approval.expiresAt ? format.relative(approval.expiresAt) : ""}</span>
          <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => router.push(`/approvals?approval=${encodeURIComponent(approval.id)}`)}>
            {t("tasks.open")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function AuditTab({ task }: { task: Task }) {
  const { t } = useT();
  const router = useRouter();
  const format = useDateFormatter();
  const query = useTaskAudit(task.id);
  const canAudit = useCapability("audit", "read");
  const footer = (
    <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} disabled={!canAudit} title={!canAudit ? t("tasks.kit.reason.missing") : undefined} onClick={() => router.push(`/audit?taskId=${encodeURIComponent(task.id)}`)}>
      {t("tasks.audit.open")}
    </Button>
  );
  if (!canAudit && query.isError) return <TabEmpty title={t("tasks.audit.unavailable")} />;
  if (query.isPending) return <Skeleton variant="row" height={48} label={t("common.loading")} />;
  if (query.isError) return <ErrorState compact title={t("common.loadError")} onRetry={() => void query.refetch()} retryLabel={t("common.retry")} />;
  if (query.data.items.length === 0) return <TabEmpty title={t("tasks.audit.empty")} />;
  return (
    <div className="tk-tab">
      <ul className="tk-list">
        {query.data.items.map((event) => (
          <li key={event.id} className="tk-list__item">
            <div className="tk-list__head">
              <span className="tk-list__title tk-mono">{event.action}</span>
              <TagPill tone={event.result === "success" ? "green" : event.result === "pending" ? "amber" : "red"}>{t(`tasks.audit.result.${event.result}` as MessageKey)}</TagPill>
              <span className="tk-list__aside">{format.dateTime(event.occurredAt)}</span>
            </div>
            <span className="tk-muted">
              {event.actor.name ?? event.actor.id} · {event.category}
            </span>
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}

export interface TaskDrawerProps {
  taskId: string | null;
  tab: TaskTab;
  onTabChange: (tab: TaskTab) => void;
  onClose: () => void;
}

/** Detail drawer of `/tasks?task=…` with the nine tabs of PLAN §28.4 and the capability-gated actions of §28.5. */
export function TaskDrawer({ taskId, tab, onTabChange, onClose }: TaskDrawerProps) {
  const { t } = useT();
  const query = useTask(taskId);
  const task = query.data?.data;
  const commands = useTaskCommands();
  const states = useTaskActionStates(task);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const canReadAgents = useCapability("agents", "read");

  const tabs = useMemo<TabItem[]>(() => {
    if (!task) return [];
    return [
      { id: "overview", label: t("tasks.tab.overview"), content: <OverviewTab task={task} assignable={canReadAgents} /> },
      { id: "steps", label: t("tasks.tab.steps"), count: task.steps.length, content: <StepsTab task={task} /> },
      { id: "activity", label: t("tasks.tab.activity"), content: <ActivityTab task={task} /> },
      { id: "tools", label: t("tasks.tab.tools"), count: task.toolCalls.length, content: <ToolsTab task={task} /> },
      { id: "sources", label: t("tasks.tab.sources"), count: task.sourceRefs.length, content: <SourcesTab task={task} /> },
      { id: "artifacts", label: t("tasks.tab.artifacts"), count: task.artifactCount, content: <ArtifactsTab task={task} /> },
      { id: "approvals", label: t("tasks.tab.approvals"), count: task.approvalIds.length, content: <ApprovalsTab task={task} /> },
      { id: "errors", label: t("tasks.tab.errors"), count: task.errors.length, content: task.errors.length > 0 ? <ErrorList errors={task.errors} /> : <TabEmpty title={t("tasks.errors.empty")} /> },
      { id: "audit", label: t("tasks.tab.audit"), content: <AuditTab task={task} /> },
    ];
  }, [task, t, canReadAgents]);

  let body: ReactNode;
  if (query.isPending && taskId) body = <Skeleton variant="block" height={220} label={t("common.loading")} />;
  else if (query.isError) {
    const notFound = isFridayApiError(query.error) && query.error.code === "NOT_FOUND";
    body = notFound ? (
      <EmptyState compact title={t("tasks.drawer.notFound")} description={t("tasks.drawer.notFoundHint")} />
    ) : (
      <ErrorState compact title={t("common.loadError")} description={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} retryLabel={t("common.retry")} />
    );
  } else if (task) {
    body = (
      <>
        <div className="mod-heading">
          <h3 className="mod-heading__title">{task.title}</h3>
          <DataOrigin sources={[task.source]} freshness={query.data?.freshness} />
        </div>
        <Tabs label={t("tasks.drawer.tabs")} items={tabs} value={tab} onValueChange={(next) => onTabChange(next as TaskTab)} />
      </>
    );
  } else body = null;

  const footer = task ? (
    <div className="tk-actions" role="group" aria-label={t("tasks.drawer.actions")}>
      <GatedButton size="sm" variant="primary" icon={<Check size={14} />} gate={states.approveResult.gate} blockedReason={states.approveResult.blockedReason} disabled={commands.pending} onClick={() => commands.approveResult(task)}>
        {t("tasks.action.approveResult")}
      </GatedButton>
      <GatedButton size="sm" variant="ghost" icon={<Pause size={14} />} gate={states.pause.gate} blockedReason={states.pause.blockedReason} disabled={commands.pending} onClick={() => commands.run("pause", task)}>
        {t("tasks.action.pause")}
      </GatedButton>
      <GatedButton size="sm" variant="ghost" icon={<Play size={14} />} gate={states.resume.gate} blockedReason={states.resume.blockedReason} disabled={commands.pending} onClick={() => commands.run("resume", task)}>
        {t("tasks.action.resume")}
      </GatedButton>
      <GatedButton size="sm" variant="ghost" icon={<RotateCcw size={14} />} gate={states.retry.gate} blockedReason={states.retry.blockedReason} disabled={commands.pending} onClick={() => commands.run("retry", task)}>
        {t("tasks.action.retry")}
      </GatedButton>
      <GatedButton size="sm" variant="danger" icon={<Ban size={14} />} gate={states.cancel.gate} blockedReason={states.cancel.blockedReason} disabled={commands.pending} onClick={() => setConfirmCancel(true)}>
        {t("tasks.action.cancel")}
      </GatedButton>
    </div>
  ) : null;

  return (
    <>
      <Drawer
        open={taskId !== null}
        onOpenChange={(open) => !open && onClose()}
        title={t("tasks.drawer.title")}
        subtitle={
          task ? (
            <span className="tk-drawer__sub">
              <code>{task.id}</code>
              <CopyButton value={task.id} label={t("tasks.copyId")} />
            </span>
          ) : undefined
        }
        width={640}
        className="mod-drawer"
        closeLabel={t("common.close")}
        footer={footer}
      >
        {body}
      </Drawer>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t("tasks.cancel.title")}
        description={t("tasks.cancel.description")}
        details={task ? [task.title, t("tasks.cancel.history")] : undefined}
        confirmLabel={t("tasks.cancel.confirm")}
        cancelLabel={t("tasks.cancel.keep")}
        tone="danger"
        loading={commands.pending}
        onConfirm={() => {
          if (task) commands.run("cancel", task);
          setConfirmCancel(false);
        }}
      />
    </>
  );
}
