"use client";

import type { Task } from "@jarvis/sdk";
import { Button, Timeline, type TimelineItem } from "@jarvis/ui";
import { useMemo, useState } from "react";
import { useT, type MessageKey } from "@/i18n";
import { STATUS_TONE, progressPercent } from "./model";
import { useDateFormatter } from "./moduleKit";
import "./tasks.css";

const PAGE = 80;

export interface TaskTimelineProps {
  tasks: readonly Task[];
  onOpen: (task: Task) => void;
}

/** Chronological view: tasks by last activity, grouped by day; history (done, failed, cancelled) stays in place. */
export function TaskTimeline({ tasks, onOpen }: TaskTimelineProps) {
  const { t } = useT();
  const format = useDateFormatter();
  const [shown, setShown] = useState(PAGE);

  const sorted = useMemo(() => {
    const key = (task: Task): number => Date.parse(task.lastActivityAt ?? task.updatedAt);
    return tasks.slice().sort((a, b) => key(b) - key(a));
  }, [tasks]);

  const groups = useMemo(() => {
    const dayFormat = new Intl.DateTimeFormat(format.locale, { weekday: "long", day: "2-digit", month: "long" });
    const byDay = new Map<string, { label: string; items: TimelineItem[]; tasks: Map<string, Task> }>();
    for (const task of sorted.slice(0, shown)) {
      const at = new Date(task.lastActivityAt ?? task.updatedAt);
      const dayKey = `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;
      let group = byDay.get(dayKey);
      if (!group) {
        group = { label: dayFormat.format(at), items: [], tasks: new Map() };
        byDay.set(dayKey, group);
      }
      const progress = progressPercent(task);
      group.tasks.set(task.id, task);
      group.items.push({
        id: task.id,
        time: format.time(task.lastActivityAt ?? task.updatedAt).slice(0, 5),
        title: task.title,
        status: task.status === "done" ? "done" : task.status === "running" ? "now" : task.status === "failed" || task.status === "cancelled" || task.blockers.length > 0 ? "blocked" : "upcoming",
        tone: STATUS_TONE[task.status],
        meta: t(`tasks.status.${task.status}` as MessageKey),
        progress,
      });
    }
    return [...byDay.values()];
  }, [sorted, shown, format, t]);

  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  return (
    <div className="tk-timeline">
      {groups.map((group) => (
        <section key={group.label} className="tk-timeline__day">
          <h3 className="tk-tab__h">{group.label}</h3>
          <Timeline
            label={`${t("tasks.timeline.label")}: ${group.label}`}
            items={group.items}
            onSelect={(id) => {
              const task = byId.get(id);
              if (task) onOpen(task);
            }}
          />
        </section>
      ))}
      {sorted.length > shown ? (
        <Button size="sm" variant="ghost" onClick={() => setShown((count) => count + PAGE)}>
          {t("tasks.board.showMore", { count: sorted.length - shown })}
        </Button>
      ) : null}
    </div>
  );
}
