"use client";

import type { FileItem, FileItemResponse } from "@friday/sdk";
import { Button, Dialog, TextField } from "@friday/ui";
import { useRef, useState, type FormEvent } from "react";
import { useT } from "@/i18n";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import { useRunStagedWrite, useStagedWriteBusy } from "@/lib/api/stagedWrite";

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

/** "Umbenennen" (PLAN §37.3): validated like the contract, saved as a staged write with the file's current version. */
export function RenameFileDialog({ file, open, onOpenChange, siblingNames }: RenameFileDialogProps) {
  const { t } = useT();
  const runStagedWrite = useRunStagedWrite();
  const busy = useStagedWriteBusy();
  const [name, setName] = useState(file.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  const problem = validateFileName(name);
  const taken = trimmed.toLowerCase() !== file.name.toLowerCase() && siblingNames.some((entry) => entry.toLowerCase() === trimmed.toLowerCase());
  const unchanged = trimmed === file.name;
  const error = problem === "invalid" ? t("files.rename.invalid") : taken ? t("files.rename.taken") : undefined;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (problem || taken || unchanged || busy) return;
    // The server stages the exact write first; the shell confirm dialog binds the preview, the repeat is unchanged.
    void runStagedWrite({
      send: (previewId) =>
        call(getApiClient().PATCH("/api/v1/files/{id}", { body: { name: trimmed },
          params: { path: { id: file.id }, header: { "If-Match": String(file.version) } },
          ...(previewId ? { headers: { "X-Action-Preview-Id": previewId } } : {}) })) as Promise<FileItemResponse>,
      successMessage: t("files.rename.done", { name: trimmed }),
      subject: file.name,
      invalidateKeys: [queryKeys.files.all],
    }).then((outcome) => {
      if (outcome !== "failed") onOpenChange(false);
    });
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
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form="fl-rename-form" loading={busy} disabled={problem !== null || taken || unchanged}>
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
          onChange={(event) => setName(event.target.value)}
        />
      </form>
    </Dialog>
  );
}
