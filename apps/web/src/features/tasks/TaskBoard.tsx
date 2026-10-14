"use client";

import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDroppable, useSensor, useSensors, type Announcements, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import type { Freshness, Task, TaskStatus } from "@jarvis/sdk";
import { Button, KanbanColumn, cx } from "@jarvis/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT, type MessageKey } from "@/i18n";
import { DraggableTaskCard, TaskCardView } from "./TaskCard";
import { BOARD_STATUSES, HISTORY_STATUSES, STATUS_TONE, type BoardStatus } from "./model";
import "./tasks.css";

/** Cards rendered per column before "Weitere anzeigen"; keeps the DOM small with 1000 tasks. */
export const COLUMN_PAGE_SIZE = 20;

export interface TaskBoardProps {
  tasks: readonly Task[];
  freshness?: Freshness;
  /** `tasks.update` granted: cards are draggable and carry the keyboard/select alternative. */
  canMove: boolean;
  lockedReason?: string;
  selectedId?: string | null;
  onOpen: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
}

interface ColumnProps {
  status: BoardStatus;
  tasks: readonly Task[];
  freshness?: Freshness;
  canMove: boolean;
  lockedReason?: string;
  selectedId?: string | null;
  onOpen: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
}

function BoardColumn({ status, tasks, freshness, canMove, lockedReason, selectedId, onOpen, onMove }: ColumnProps) {
  const { t } = useT();
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !canMove });
  const [shown, setShown] = useState(COLUMN_PAGE_SIZE);
  const visible = tasks.slice(0, shown);
  const hidden = tasks.length - visible.length;
  return (
    <div ref={setNodeRef} className={cx("tk-col", isOver && "tk-col--over")} data-status={status} data-over={isOver || undefined}>
      <KanbanColumn title={t(`tasks.status.${status}` as MessageKey)} count={tasks.length} tone={STATUS_TONE[status]} emptyLabel={t("tasks.board.emptyColumn")}>
        {visible.length > 0 ? (
          <>
            {visible.map((task) => (
              <DraggableTaskCard
                key={task.id}
                task={task}
                freshness={freshness}
                canMove={canMove}
                lockedReason={lockedReason}
                selected={selectedId === task.id}
                onOpen={onOpen}
                onMove={onMove}
              />
            ))}
            {hidden > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setShown((count) => count + COLUMN_PAGE_SIZE)}>
                {t("tasks.board.showMore", { count: hidden })}
              </Button>
            ) : null}
          </>
        ) : null}
      </KanbanColumn>
    </div>
  );
}

/**
 * Kanban board (PLAN §28.2). Drag and drop is attached only with the update capability; the same move is available by
 * keyboard (Shift+Pfeil links/rechts on the card title) and via the status select on every card.
 */
export function TaskBoard({ tasks, freshness, canMove, lockedReason, selectedId, onOpen, onMove }: TaskBoardProps) {
  const { t } = useT();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const grouped = useMemo(() => {
    const byStatus = new Map<TaskStatus, Task[]>();
    for (const task of tasks) {
      const bucket = byStatus.get(task.status);
      if (bucket) bucket.push(task);
      else byStatus.set(task.status, [task]);
    }
    return byStatus;
  }, [tasks]);

  // A moved card is re-created in its new column; keep keyboard focus on it.
  const focusAfterMove = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfterMove.current;
    if (!id) return;
    const target = document.querySelector<HTMLElement>(`[data-task-card="${CSS.escape(id)}"] .tk-card__title`);
    if (target) {
      target.focus();
      focusAfterMove.current = null;
    }
  }, [tasks]);

  const move = useCallback(
    (task: Task, status: TaskStatus) => {
      focusAfterMove.current = task.id;
      onMove(task, status);
    },
    [onMove],
  );

  // dnd-kit announces drags to screen readers in English by default.
  const announcements = useMemo<Announcements>(() => {
    const titleOf = (id: string | number): string => tasks.find((task) => task.id === id)?.title ?? String(id);
    const columnOf = (id: string | number | undefined): string => (id !== undefined && BOARD_STATUSES.includes(id as BoardStatus) ? t(`tasks.status.${id as BoardStatus}` as MessageKey) : "");
    return {
      onDragStart: ({ active }) => t("tasks.dnd.pickedUp", { title: titleOf(active.id) }),
      onDragOver: ({ active, over }) => (over ? t("tasks.dnd.over", { title: titleOf(active.id), column: columnOf(over.id) }) : undefined),
      onDragEnd: ({ active, over }) => (over ? t("tasks.dnd.dropped", { title: titleOf(active.id), column: columnOf(over.id) }) : t("tasks.dnd.cancelled", { title: titleOf(active.id) })),
      onDragCancel: ({ active }) => t("tasks.dnd.cancelled", { title: titleOf(active.id) }),
    };
  }, [tasks, t]);

  const onDragStart = (event: DragStartEvent): void => {
    setActiveTask(tasks.find((task) => task.id === event.active.id) ?? null);
  };
  const onDragEnd = (event: DragEndEvent): void => {
    setActiveTask(null);
    const task = tasks.find((candidate) => candidate.id === event.active.id);
    const target = event.over?.id;
    if (!task || typeof target !== "string" || target === task.status) return;
    if (BOARD_STATUSES.includes(target as BoardStatus)) onMove(task, target as TaskStatus);
  };

  const history = HISTORY_STATUSES.flatMap((status) => grouped.get(status) ?? []);

  return (
    <div className="tk-board-wrap">
      <DndContext sensors={sensors} accessibility={{ announcements, screenReaderInstructions: { draggable: t("tasks.dnd.instructions") } }} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveTask(null)}>
        <div className="tk-board" role="group" aria-label={t("tasks.board.label")}>
          {BOARD_STATUSES.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              tasks={grouped.get(status) ?? []}
              freshness={freshness}
              canMove={canMove}
              lockedReason={lockedReason}
              selectedId={selectedId}
              onOpen={onOpen}
              onMove={move}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>{activeTask ? <TaskCardView task={activeTask} canMove={false} overlay /> : null}</DragOverlay>
      </DndContext>

      {history.length > 0 ? (
        <section className="tk-history" aria-label={t("tasks.board.history")}>
          <button type="button" className="tk-history__toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}>
            {historyOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            {t("tasks.board.historyTitle", { failed: grouped.get("failed")?.length ?? 0, cancelled: grouped.get("cancelled")?.length ?? 0 })}
          </button>
          {historyOpen ? (
            <div className="tk-history__grid">
              {history.slice(0, COLUMN_PAGE_SIZE * 2).map((task) => (
                <TaskCardView key={task.id} task={task} freshness={freshness} canMove={false} selected={selectedId === task.id} onOpen={onOpen} />
              ))}
              {history.length > COLUMN_PAGE_SIZE * 2 ? <p className="tk-history__more">{t("tasks.board.historyMore", { count: history.length - COLUMN_PAGE_SIZE * 2 })}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

