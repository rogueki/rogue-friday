"use client";

import type { Memory, MemoryCreateRequest, MemorySensitivity, MemoryType, MemoryUpdateRequest } from "@friday/sdk";
import { Button, Dialog, Select, Switch, TextField } from "@friday/ui";
import { useState, type FormEvent } from "react";
import { useT } from "@/i18n";
import { TextArea } from "./kit/fields";
import { MEMORY_SENSITIVITIES, MEMORY_TYPES, sensitivityKey, typeKey } from "./labels";

interface FormValues {
  type: MemoryType;
  title: string;
  content: string;
  confidence: string;
  tags: string;
  sensitivity: MemorySensitivity;
  expiresOn: string;
  pinned: boolean;
}

interface FormErrors {
  content?: string;
  confidence?: string;
  expiresOn?: string;
}

const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");
const parseTags = (raw: string): string[] => Array.from(new Set(raw.split(/[,\n]/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean)));

function initialValues(memory?: Memory): FormValues {
  return {
    type: memory?.type ?? "fact",
    title: memory?.title ?? "",
    content: memory?.content ?? "",
    confidence: String(Math.round((memory?.confidence ?? 1) * 100)),
    tags: memory?.tags.join(", ") ?? "",
    sensitivity: memory?.sensitivity ?? "normal",
    expiresOn: toDateInput(memory?.expiresAt ?? null),
    pinned: memory?.pinned ?? false,
  };
}

export interface MemoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing memory = edit (PATCH with only the changed fields); absent = create. */
  memory?: Memory;
  busy?: boolean;
  onCreate?: (request: MemoryCreateRequest) => void;
  onUpdate?: (patch: MemoryUpdateRequest) => void;
}

/** Remount per open (`key`) so the form always starts from the current server state. */
export function MemoryFormDialog(props: MemoryFormDialogProps) {
  return props.open ? <MemoryFormDialogBody {...props} /> : null;
}

function MemoryFormDialogBody({ onOpenChange, memory, busy, onCreate, onUpdate }: MemoryFormDialogProps) {
  const { t } = useT();
  const [values, setValues] = useState<FormValues>(() => initialValues(memory));
  const [errors, setErrors] = useState<FormErrors>({});
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]): void => setValues((current) => ({ ...current, [key]: value }));
  const editing = memory !== undefined;

  const validate = (): { errors: FormErrors; confidence: number } => {
    const found: FormErrors = {};
    if (values.content.trim() === "") found.content = t("memory.form.error.content");
    const confidence = Number(values.confidence);
    if (!Number.isFinite(confidence) || values.confidence.trim() === "" || confidence < 0 || confidence > 100) found.confidence = t("memory.form.error.confidence");
    if (values.expiresOn !== "" && Number.isNaN(Date.parse(`${values.expiresOn}T00:00:00Z`))) found.expiresOn = t("memory.form.error.expires");
    return { errors: found, confidence: Math.min(1, Math.max(0, confidence / 100)) };
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const result = validate();
    setErrors(result.errors);
    if (Object.keys(result.errors).length > 0) return;
    const expiresAt = values.expiresOn === "" ? null : `${values.expiresOn}T23:59:59Z`;
    const tags = parseTags(values.tags);
    const title = values.title.trim();
    if (!editing) {
      onCreate?.({
        type: values.type,
        content: values.content.trim(),
        ...(title ? { title } : {}),
        confidence: result.confidence,
        tags,
        sensitivity: values.sensitivity,
        pinned: values.pinned,
        expiresAt,
      });
      return;
    }
    const patch: MemoryUpdateRequest = {};
    if (values.type !== memory.type) patch.type = values.type;
    if (title !== (memory.title ?? "") && title !== "") patch.title = title;
    if (values.content.trim() !== memory.content) patch.content = values.content.trim();
    if (Math.abs(result.confidence - memory.confidence) > 0.0001) patch.confidence = result.confidence;
    if (tags.join("\n") !== memory.tags.join("\n")) patch.tags = tags;
    if (values.sensitivity !== memory.sensitivity) patch.sensitivity = values.sensitivity;
    if (expiresAt !== null ? toDateInput(memory.expiresAt) !== values.expiresOn : memory.expiresAt !== null) patch.expiresAt = expiresAt;
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    onUpdate?.(patch);
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={editing ? t("memory.form.editTitle") : t("memory.form.createTitle")}
      description={editing ? t("memory.form.editDescription") : t("memory.form.createDescription")}
      size="lg"
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="memory-form" loading={busy}>
            {editing ? t("memory.kit.save") : t("memory.form.create")}
          </Button>
        </>
      }
    >
      <form id="memory-form" className="mk-form" onSubmit={submit} noValidate>
        <div className="mk-grid-2">
          <Select
            label={t("memory.field.type")}
            value={values.type}
            onChange={(event) => set("type", event.target.value as MemoryType)}
            options={MEMORY_TYPES.map((type) => ({ value: type, label: t(typeKey(type)) }))}
          />
          <Select
            label={t("memory.field.sensitivity")}
            value={values.sensitivity}
            onChange={(event) => set("sensitivity", event.target.value as MemorySensitivity)}
            options={MEMORY_SENSITIVITIES.map((value) => ({ value, label: t(sensitivityKey(value)) }))}
          />
        </div>
        <TextField label={t("memory.field.title")} value={values.title} onChange={(event) => set("title", event.target.value)} maxLength={120} />
        <TextArea label={t("memory.field.content")} value={values.content} onChange={(event) => set("content", event.target.value)} required error={errors.content} rows={6} />
        <div className="mk-grid-3">
          <TextField
            label={t("memory.field.confidencePercent")}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={values.confidence}
            onChange={(event) => set("confidence", event.target.value)}
            error={errors.confidence}
          />
          <TextField label={t("memory.field.expires")} type="date" value={values.expiresOn} onChange={(event) => set("expiresOn", event.target.value)} error={errors.expiresOn} hint={t("memory.field.expiresHint")} />
          <TextField label={t("memory.field.tags")} value={values.tags} onChange={(event) => set("tags", event.target.value)} hint={t("memory.field.tagsHint")} />
        </div>
        {!editing ? (
          <Switch label={t("memory.field.pinned")} checked={values.pinned} onCheckedChange={(checked) => set("pinned", checked)} stateLabels={[t("memory.kit.on"), t("memory.kit.off")]} />
        ) : null}
      </form>
    </Dialog>
  );
}
