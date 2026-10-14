"use client";

import type { Priority } from "@jarvis/sdk";
import { Button, Dialog, Select, TextField, useToast } from "@jarvis/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useT, type MessageKey } from "@/i18n";
import { useCreateTask } from "@/lib/api/domains/tasks";
import { useCapability } from "@/lib/capabilities";

interface CreateTaskStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useCreateTaskDialog = create<CreateTaskStore>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

const PRIORITIES: readonly Priority[] = ["P2", "P1", "P0", "P3", "P4"];

/** Quick task creation (palette, quick commands). Needs `tasks.create`; the server validates and audits the creation. */
export function CreateTaskDialog() {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const open = useCreateTaskDialog((s) => s.open);
  const setOpen = useCreateTaskDialog((s) => s.setOpen);
  const canCreate = useCapability("tasks", "create");
  const createTask = useCreateTask();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("P2");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setPriority("P2");
    }
  }, [open]);

  const submit = (): void => {
    const trimmed = title.trim();
    if (!trimmed || !canCreate) return;
    createTask.mutate(
      { title: trimmed, priority },
      {
        onSuccess: (response) => {
          setOpen(false);
          toast({
            title: t("task.created"),
            description: response.data.title,
            tone: "green",
            action: { label: t("command.open"), onClick: () => router.push(`/tasks?task=${encodeURIComponent(response.data.id)}`) },
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t("task.create.title")}
      description={canCreate ? undefined : t("task.create.unavailable")}
      size="sm"
      initialFocusRef={inputRef}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} loading={createTask.isPending} disabled={!canCreate || title.trim().length === 0}>
            {t("task.create.submit")}
          </Button>
        </>
      }
    >
      <form
        className="web-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField ref={inputRef} label={t("task.create.name")} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} disabled={!canCreate} />
        <Select
          label={t("task.create.priority")}
          value={priority}
          onChange={(event) => setPriority(event.target.value as Priority)}
          options={PRIORITIES.map((p) => ({ value: p, label: `${p} · ${t(`priority.${p}` as MessageKey)}` }))}
          disabled={!canCreate}
        />
      </form>
    </Dialog>
  );
}
