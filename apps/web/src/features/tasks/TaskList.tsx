"use client";

import type { Freshness, Task } from "@friday/sdk";
import { DataTable, FreshnessBadge, TagPill, type DataTableColumn } from "@friday/ui";
import { useMemo } from "react";
import { useT } from "@/i18n";
import { StatusChip } from "./TaskCard";
import { PRIORITIES, PRIORITY_TONE, progressPercent, showsIndeterminate } from "./model";
import { freshAnchor, useDateFormatter, useFillHeight } from "./moduleKit";
import "./tasks.css";

export interface TaskListProps {
  tasks: readonly Task[];
  totalCount?: number;
  freshness?: Freshness;
  selectedId?: string | null;
  onOpen: (task: Task) => void;
}

/** Sortable, virtualized list view; below 560 px width the table turns into cards (PLAN §53). */
export function TaskList({ tasks, totalCount, freshness, selectedId, onOpen }: TaskListProps) {
  const { t } = useT();
  const format = useDateFormatter();
  const [fillRef, height] = useFillHeight(360);

  const columns = useMemo<DataTableColumn<Task>[]>(
    () => [
      {
        id: "priority",
        header: t("tasks.field.priority"),
        width: "98px",
        sortable: true,
        sortValue: (task) => PRIORITIES.indexOf(task.priority),
        cell: (task) => <TagPill tone={PRIORITY_TONE[task.priority]}>{task.priority}</TagPill>,
      },
      { id: "title", header: t("tasks.list.title"), width: "minmax(220px, 2.2fr)", sortable: true, sortValue: (task) => task.title },
      { id: "status", header: t("tasks.field.status"), width: "130px", sortable: true, sortValue: (task) => task.status, cell: (task) => <StatusChip status={task.status} /> },
      { id: "agent", header: t("tasks.field.agent"), width: "minmax(110px, 1fr)", sortable: true, sortValue: (task) => task.agentName ?? "", cell: (task) => task.agentName ?? t("tasks.card.unassigned") },
      { id: "model", header: t("tasks.field.model"), width: "minmax(90px, 0.9fr)", sortable: true, sortValue: (task) => task.model ?? "", mono: true, cell: (task) => task.model ?? "—" },
      {
        id: "progress",
        header: t("tasks.field.progress"),
        width: "124px",
        sortable: true,
        sortValue: (task) => progressPercent(task),
        mono: true,
        cell: (task) => {
          const percent = progressPercent(task);
          if (percent !== null) return `${percent} %`;
          return showsIndeterminate(task) ? t("tasks.list.progressRunning") : "—";
        },
      },
      { id: "runtime", header: t("tasks.field.runtime"), width: "118px", sortable: true, sortValue: (task) => task.runtimeMs, mono: true, cell: (task) => format.duration(task.runtimeMs) },
      {
        id: "activity",
        header: t("tasks.field.lastActivity"),
        width: "150px",
        sortable: true,
        sortValue: (task) => (task.lastActivityAt ? Date.parse(task.lastActivityAt) : null),
        cell: (task) => format.relative(task.lastActivityAt),
      },
      { id: "artifacts", header: t("tasks.field.artifacts"), width: "112px", align: "right", sortable: true, sortValue: (task) => task.artifactCount, mono: true, hideInCards: false },
      {
        id: "source",
        header: t("tasks.card.source"),
        width: "minmax(100px, 1fr)",
        sortable: true,
        sortValue: (task) => task.source.system,
        cell: (task) => (
          <span className="tk-list-source">
            {task.source.system}
            {freshness && freshness.state !== "fresh" ? <FreshnessBadge state={freshness.state} asOf={task.source.lastSyncedAt} now={freshAnchor(format.now, task.source.lastSyncedAt)} locale={format.locale} /> : null}
          </span>
        ),
      },
    ],
    [t, format, freshness],
  );

  return (
    <div className="tk-fill" ref={fillRef}>
      <DataTable
        label={t("tasks.list.label")}
        columns={columns}
        rows={tasks}
        getRowId={(task) => task.id}
        height={height - 34}
        defaultSort={null}
        onRowActivate={onOpen}
        selectedId={selectedId ?? undefined}
        totalCount={totalCount}
        empty={<p className="tk-muted">{t("tasks.empty.filtered")}</p>}
        countLabel={(shown, total) => t("tasks.list.count", { shown, total })}
      />
    </div>
  );
}

