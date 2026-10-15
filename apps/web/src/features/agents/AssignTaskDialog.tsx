"use client";

import type { Agent, Task } from "@friday/sdk";
import { Button, Dialog, EmptyState, Select, Skeleton } from "@friday/ui";
import { UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useT, type MessageKey } from "@/i18n";
import { useTasks } from "@/lib/api/domains/tasks";
import { useTaskCommands } from "@/features/tasks/useTaskCommands";
import "./agents.css";

const OPEN_STATUSES: Task["status"][] = ["triage", "todo", "ready", "running", "waiting", "review"];

/** "Assign Task": hands an open task to this agent (a task update, so `If-Match` carries the task version). */
export function AssignTaskDialog({ agent, open, onOpenChange }: { agent: Agent; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useT();
  const commands = useTaskCommands();
  const query = useTasks({ status: OPEN_STATUSES, limit: 100, sort: "-updatedAt" });
  const [taskId, setTaskId] = useState("");

  useEffect(() => {
    if (open) setTaskId("");
  }, [open]);

  const tasks = (query.data?.items ?? []).filter((task) => task.agentId !== agent.id);
  const selected = tasks.find((task) => task.id === taskId);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("agents.assign.title")}
      description={t("agents.assign.description", { agent: agent.name })}
      size="sm"
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={<UserPlus size={14} />}
            disabled={!selected || commands.pending}
            loading={commands.pending}
            onClick={() => {
              if (!selected) return;
              commands.assign(selected, agent.id);
              onOpenChange(false);
            }}
          >
            {t("agents.assign.confirm")}
          </Button>
        </>
      }
    >
      {query.isPending ? (
        <Skeleton variant="row" height={40} label={t("common.loading")} />
      ) : tasks.length === 0 ? (
        <EmptyState compact title={t("agents.assign.empty")} />
      ) : (
        <Select
          label={t("agents.assign.task")}
          value={taskId}
          onChange={(event) => setTaskId(event.target.value)}
          options={[
            { value: "", label: t("agents.assign.choose") },
            ...tasks.map((task) => ({ value: task.id, label: `${task.priority} · ${task.title} (${t(`tasks.status.${task.status}` as MessageKey)}${task.agentName ? `, ${task.agentName}` : ""})` })),
          ]}
        />
      )}
    </Dialog>
  );
}
