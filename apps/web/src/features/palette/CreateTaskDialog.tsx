"use client";

import type { Priority } from "@friday/sdk";
import { Button, Dialog, Select, TextField } from "@friday/ui";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useT, type MessageKey } from "@/i18n";
import { useCapability } from "@/lib/capabilities";
import { useRunTaskWrite } from "@/features/tasks/taskWriteRunner";

interface CreateTaskStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useCreateTaskDialog = create<CreateTaskStore>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

const PRIORITIES: readonly Priority[] = ["P2", "P1", "P0", "P3", "P4"];

/** Quick task creation (palette, quick commands). Needs `tasks.create`; the server validates and audits the creation. */
export function CreateTaskDialog() {
  const { t } = useT();
  const open = useCreateTaskDialog((s) => s.open);
  const setOpen = useCreateTaskDialog((s) => s.setOpen);
  const canCreate = useCapability("tasks", "create");
  const runTaskWrite = useRunTaskWrite();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("P2");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setPriority("P2");
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed || !canCreate || busy) return;
    setBusy(true);
    try {
      const outcome = await runTaskWrite({ kind: "create", body: { title: trimmed, priority },
        successMessage: t("task.created"), taskTitle: trimmed });
      if (outcome !== "failed") setOpen(false);
    } finally { setBusy(false); }
  };

  const createBlocked = !canCreate
    ? t("task.create.unavailable")
    : title.trim().length === 0
      ? t("task.create.titleRequired")
      : undefined;

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
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={createBlocked !== undefined} title={createBlocked}>
            {t("task.create.submit")}
          </Button>
        </>
      }
    >
      <form
        className="web-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
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
