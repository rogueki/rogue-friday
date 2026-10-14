"use client";

import type { FileItem } from "@jarvis/sdk";
import { isJarvisApiError } from "@jarvis/sdk";
import { Button, Dialog, TextField, useToast } from "@jarvis/ui";
import { useRef, useState, type FormEvent } from "react";
import { useT } from "@/i18n";
import { useRenameFile } from "@/lib/api/domains/files";

/** Characters a file name must not contain (path separators, reserved Windows characters, control characters). */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is being rejected
const FORBIDDEN_NAME = /[\\/<>:"|?*\u0000-\u001f]/;

/** Client-side check that mirrors the contract (FileRenameRequest); the server stays the authority. */
export function validateFileName(name: string): "empty" | "invalid" | null {
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if (trimmed.length > 255 || FORBIDDEN_NAME.test(trimmed) || /^\.+$/.test(trimmed) || /[. ]$/.test(trimmed)) return "invalid";
  return null;
}

interface RenameFileDialogProps {
  file: FileItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names already used in the same location (case-insensitive duplicates are refused before the request). */
  siblingNames: readonly string[];
}

/** "Umbenennen" (PLAN §37.3): one text field, validated like the contract, saved with the file's current version. */
export function RenameFileDialog({ file, open, onOpenChange, siblingNames }: RenameFileDialogProps) {
  const { t } = useT();
  const { toast } = useToast();
  const rename = useRenameFile();
  const [name, setName] = useState(file.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  const problem = validateFileName(name);
  const taken = trimmed.toLowerCase() !== file.name.toLowerCase() && siblingNames.some((entry) => entry.toLowerCase() === trimmed.toLowerCase());
  const unchanged = trimmed === file.name;
  const serverError = rename.error ? (isJarvisApiError(rename.error) ? rename.error.message : t("files.rename.error")) : undefined;
  const error = problem === "invalid" ? t("files.rename.invalid") : taken ? t("files.rename.taken") : serverError;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (problem || taken || unchanged || rename.isPending) return;
    rename.mutate(
      { id: file.id, version: file.version, name: trimmed },
      {
        onSuccess: (response) => {
          toast({ title: t("files.rename.done", { name: response.data.name }), tone: "green", duration: 3500 });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("files.rename.title", { name: file.name })}
      description={t("files.rename.description")}
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={rename.isPending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form="fl-rename-form" loading={rename.isPending} disabled={problem !== null || taken || unchanged}>
            {t("files.rename.confirm")}
          </Button>
        </>
      }
    >
      <form id="fl-rename-form" onSubmit={submit}>
        <TextField
          ref={inputRef}
          label={t("files.rename.label")}
          hint={unchanged ? t("files.rename.unchanged") : t("files.rename.hint")}
          value={name}
          maxLength={255}
          autoComplete="off"
          spellCheck={false}
          error={error}
          onChange={(event) => {
            setName(event.target.value);
            if (rename.isError) rename.reset();
          }}
        />
      </form>
    </Dialog>
  );
}
