"use client";

import type { Freshness, Task, TaskStatus } from "@friday/sdk";
import { FreshnessBadge, Select, StatusDot, TagPill, cx } from "@friday/ui";
import { useDraggable } from "@dnd-kit/core";
import { AlertTriangle, Bot, Clock3, Database, Lock, Paperclip, Timer } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useT, type MessageKey } from "@/i18n";
import { BOARD_STATUSES, PRIORITY_TONE, STATUS_TONE, isBoardStatus, isOverdue, progressPercent, showsIndeterminate } from "./model";
import { freshAnchor, useDateFormatter } from "./moduleKit";
import "./tasks.css";

export interface TaskCardViewProps {
  task: Task;
  freshness?: Freshness;
  canMove: boolean;
  /** Read-only capability hint (lock icon instead of the move control). */
  lockedReason?: string;
  selected?: boolean;
  dragging?: boolean;
  /** Overlay copy while dragging: static, not focusable. */
  overlay?: boolean;
  onOpen?: (task: Task) => void;
  onMove?: (task: Task, status: TaskStatus) => void;
}

/** Progress bar: a number only for determinate progress, an indeterminate bar otherwise, nothing for idle work. */
export function TaskProgress({ task, label }: { task: Task; label: string }) {
  const { t } = useT();
  const percent = progressPercent(task);
  const indeterminate = showsIndeterminate(task);
  if (percent === null && !indeterminate) return null;
  return (
    <div
      className={cx("jv-progress", indeterminate && "jv-progress--indeterminate")}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={percent === null ? t("tasks.card.progressUnknown") : `${percent} %`}
    >
      <span className="jv-progress__bar" style={percent === null ? undefined : { width: `${percent}%` }} />
    </div>
  );
}

export function StatusChip({ status }: { status: TaskStatus }) {
  const { t } = useT();
  const tone = STATUS_TONE[status];
  return (
    <span className={cx("tk-status", `jv-tone-${tone}`)} data-status={status}>
      <StatusDot tone={tone} pulse={status === "running"} />
      {t(`tasks.status.${status}` as MessageKey)}
    </span>
  );
}

/** Task card of the board (PLAN §28.3): title, priority, status, agent, model, progress, runtime, blocker, activity, artifacts, source, freshness. */
export function TaskCardView({ task, freshness, canMove, lockedReason, selected, dragging, overlay, onOpen, onMove }: TaskCardViewProps) {
  const { t } = useT();
  const format = useDateFormatter();
  const overdue = isOverdue(task, format.now);
  const firstBlocker = task.blockers[0];
  const stale = freshness && freshness.state !== "fresh" ? freshness : null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (!canMove || !onMove || !event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    const index = BOARD_STATUSES.findIndex((status) => status === task.status);
    if (index < 0) return;
    const target = BOARD_STATUSES[index + (event.key === "ArrowRight" ? 1 : -1)];
    if (!target) return;
    event.preventDefault();
    onMove(task, target);
  };

  return (
    <article
      className={cx("jv-card jv-task tk-card", selected && "jv-card--selected", dragging && "tk-card--dragging", overlay && "tk-card--overlay")}
      data-task-card={task.id}
      data-status={task.status}
      aria-label={overlay ? undefined : `${task.title}, ${t(`tasks.status.${task.status}` as MessageKey)}, ${task.priority}`}
    >
      <div className="tk-card__top">
        <TagPill tone={PRIORITY_TONE[task.priority]} title={t(`priority.${task.priority}` as MessageKey)}>
          {task.priority}
        </TagPill>
        {overlay ? (
          <span className="tk-card__title">{task.title}</span>
        ) : (
          <button type="button" className="tk-card__title" onClick={() => onOpen?.(task)} onKeyDown={onKeyDown} aria-keyshortcuts={canMove ? "Shift+ArrowLeft Shift+ArrowRight" : undefined}>
            {task.title}
          </button>
        )}
        {!canMove && lockedReason ? (
          <span className="tk-card__lock" title={lockedReason}>
            <Lock size={12} strokeWidth={1.75} aria-hidden="true" />
            <span className="jv-sr-only">{lockedReason}</span>
          </span>
        ) : null}
      </div>

      <div className="tk-card__meta">
        <StatusChip status={task.status} />
        <span className="tk-card__agent" title={t("tasks.card.agent")}>
          <Bot size={12} strokeWidth={1.75} aria-hidden="true" />
          {task.agentName ?? (task.agentId ? task.agentId : t("tasks.card.unassigned"))}
        </span>
      </div>

      <div className="tk-card__facts">
        <span className="tk-card__model" title={t("tasks.card.model")}>
          {task.model ?? "—"}
        </span>
        <span title={t("tasks.card.runtime")}>
          <Timer size={11} strokeWidth={1.75} aria-hidden="true" />
          <span className="jv-sr-only">{t("tasks.card.runtime")}: </span>
          {format.duration(task.runtimeMs)}
        </span>
        <span title={t("tasks.card.lastActivity")}>
          <Clock3 size={11} strokeWidth={1.75} aria-hidden="true" />
          <span className="jv-sr-only">{t("tasks.card.lastActivity")}: </span>
          {format.relative(task.lastActivityAt)}
        </span>
      </div>

      {firstBlocker ? (
        <div className="jv-task__blocked tk-card__blocker">
          <AlertTriangle size={12} strokeWidth={1.75} aria-hidden="true" />
          <span>
            <span className="jv-sr-only">{t("tasks.card.blocker")}: </span>
            {firstBlocker.description}
            {task.blockers.length > 1 ? ` ${t("tasks.card.moreBlockers", { count: task.blockers.length - 1 })}` : ""}
          </span>
        </div>
      ) : null}

      <TaskProgress task={task} label={`${task.title}: ${t("tasks.card.progress")}`} />

      <div className="tk-card__foot">
        <span title={t("tasks.card.artifacts", { count: task.artifactCount })}>
          <Paperclip size={11} strokeWidth={1.75} aria-hidden="true" />
          {task.artifactCount}
          <span className="jv-sr-only"> {t("tasks.card.artifactsShort")}</span>
        </span>
        {task.dueAt ? (
          <span className={cx(overdue && "jv-tone-red")} title={t("tasks.card.due")}>
            <span className="jv-sr-only">{overdue ? t("tasks.card.overdue") : t("tasks.card.due")}: </span>
            {format.dateTime(task.dueAt)}
          </span>
        ) : null}
        <span className="tk-card__source" title={`${t("tasks.card.source")}: ${task.source.system} (${task.source.adapterId})`}>
          <Database size={11} strokeWidth={1.75} aria-hidden="true" />
          <span className="jv-sr-only">{t("tasks.card.source")}: </span>
          {task.source.system}
        </span>
        {stale ? <FreshnessBadge state={stale.state} asOf={task.source.lastSyncedAt} now={freshAnchor(format.now, task.source.lastSyncedAt)} locale={format.locale} /> : null}
      </div>

      {canMove && onMove && !overlay ? (
        <Select
          className="tk-card__move"
          label={t("tasks.card.move", { title: task.title })}
          hideLabel
          value={isBoardStatus(task.status) ? task.status : ""}
          options={[
            ...(isBoardStatus(task.status) ? [] : [{ value: "", label: t(`tasks.status.${task.status}` as MessageKey), disabled: true }]),
            ...BOARD_STATUSES.map((status) => ({ value: status, label: t(`tasks.status.${status}` as MessageKey) })),
          ]}
          onChange={(event) => {
            const next = event.target.value as TaskStatus;
            if (next && next !== task.status) onMove(task, next);
          }}
        />
      ) : null}
    </article>
  );
}

/** Draggable wrapper; dragging is only attached when the update capability is granted (PLAN §28.6). */
export function DraggableTaskCard(props: TaskCardViewProps) {
  const { task, canMove } = props;
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: task.id, data: { status: task.status }, disabled: !canMove });
  return (
    <div ref={setNodeRef} className="tk-draggable" data-draggable={canMove ? "true" : "false"} {...(canMove ? listeners : {})}>
      <TaskCardView {...props} dragging={isDragging} />
    </div>
  );
}
