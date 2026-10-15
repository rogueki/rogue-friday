"use client";

import type { Task } from "@friday/sdk";
import { Button, Dialog, TextArea, useToast } from "@friday/ui";
import { MessageSquareReply } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useT } from "@/i18n";
import { useProvideTaskInput } from "@/lib/api/domains/tasks";

/** Contract limit of `TaskInputRequest.input`. */
export const MAX_INPUT_LENGTH = 4000;

interface ProvideInputDialogProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Eingabe geben": the answer to a task that waits for input (blocker `input_needed`). It goes to the agent through
 * POST /tasks/{id}/input; nothing is approved here, and the text is neither logged nor audited by the server.
 */
export function ProvideInputDialog({ task, open, onOpenChange }: ProvideInputDialogProps) {
  const { t } = useT();
  const { toast } = useToast();
  const send = useProvideTaskInput();
  const [text, setText] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const blocker = task.blockers.find((candidate) => candidate.kind === "input_needed");
  const trimmed = text.trim();
  const empty = trimmed === "";

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (empty || send.isPending) return;
    send.mutate(
      { id: task.id, version: task.version, input: trimmed, ...(blocker ? { blockerId: blocker.id } : {}) },
      {
        onSuccess: () => {
          toast({ title: t("tasks.input.sent"), description: task.title, tone: "green", duration: 3500 });
          setText("");
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("tasks.input.title", { title: task.title })}
      description={blocker?.description ?? t("tasks.decisions.why.input")}
      icon={<MessageSquareReply size={16} strokeWidth={1.5} />}
      initialFocusRef={fieldRef}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={send.isPending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form={`tk-input-${task.id}`} loading={send.isPending} disabled={empty}>
            {t("tasks.input.send")}
          </Button>
        </>
      }
    >
      <form id={`tk-input-${task.id}`} onSubmit={submit}>
        <TextArea
          ref={fieldRef}
          label={t("tasks.input.label")}
          hint={t("tasks.input.hint")}
          value={text}
          maxLength={MAX_INPUT_LENGTH}
          showCount
          rows={6}
          onChange={(event) => setText(event.target.value)}
        />
      </form>
    </Dialog>
  );
}
