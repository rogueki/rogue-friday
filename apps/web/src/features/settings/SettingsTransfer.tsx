"use client";

import type { SettingsExport } from "@jarvis/sdk";
import { Button, ConfirmDialog, Dialog } from "@jarvis/ui";
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useT } from "@/i18n";
import { fetchSettingsExport, useImportSettings } from "@/lib/api/domains/settings";
import { useToast } from "@jarvis/ui";
import { useSettingsDrafts } from "./SettingsDrafts";
import { downloadJson, parseSettingsImport } from "./settingsLogic";

/** Export (`GET /settings/export`, never secrets) and schema-validated import of a settings document (PLAN §25.5). */
export function SettingsTransfer() {
  const { t } = useT();
  const { readOnly, role, dirtyAreas, externalDirty } = useSettingsDrafts();
  const { toast } = useToast();
  const importSettings = useImportSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [pending, setPending] = useState<SettingsExport | null>(null);
  const owner = role === "owner";

  const doExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const document = await fetchSettingsExport();
      downloadJson(`friday-settings-${document.exportedAt.slice(0, 10)}.json`, document);
    } catch (error) {
      toast({ title: t("settings.transfer.exportFailed"), description: error instanceof Error ? error.message : undefined, tone: "red" });
    } finally {
      setExporting(false);
    }
  };

  const onFile = async (file: File): Promise<void> => {
    const parsed = parseSettingsImport(await file.text());
    if (!parsed.ok) {
      setProblems(parsed.errors);
      return;
    }
    setPending(parsed.value);
  };

  const confirm = async (): Promise<void> => {
    if (!pending) return;
    try {
      await importSettings.mutateAsync({ document: pending });
      toast({ title: t("settings.transfer.imported"), tone: "green" });
    } catch {
      // the mutation cache already shows the error toast; keep the dialog closed so the user can retry from the file picker
    } finally {
      setPending(null);
    }
  };

  const areas = pending ? Object.keys(pending.settings).length : 0;
  const unsaved = dirtyAreas.length + externalDirty.length > 0;
  return (
    <div className="st-transfer">
      <Button type="button" variant="ghost" size="sm" icon={<Download size={14} />} loading={exporting} disabled={!owner} onClick={() => void doExport()}>
        {t("settings.transfer.export")}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="st-file"
        aria-label={t("settings.transfer.file")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onFile(file);
        }}
      />
      <Button type="button" variant="ghost" size="sm" icon={<Upload size={14} />} disabled={readOnly} onClick={() => fileRef.current?.click()}>
        {t("settings.transfer.import")}
      </Button>
      <Dialog open={problems !== null} onOpenChange={(open) => !open && setProblems(null)} title={t("settings.transfer.invalidTitle")} tone="red" description={t("settings.transfer.invalidDesc")} footer={<Button onClick={() => setProblems(null)}>{t("common.close")}</Button>}>
        <ul className="st-errorlist__items">
          {(problems ?? []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Dialog>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("settings.transfer.confirmTitle")}
        description={t("settings.transfer.confirmDesc")}
        details={[
          t("settings.transfer.areas", { count: areas }),
          t("settings.transfer.themes", { count: pending?.themes.length ?? 0 }),
          t("settings.transfer.layouts", { count: pending?.layouts.length ?? 0 }),
          t("settings.transfer.noSecrets"),
          ...(unsaved ? [t("settings.transfer.unsaved")] : []),
        ]}
        confirmLabel={t("settings.transfer.confirm")}
        cancelLabel={t("common.cancel")}
        loading={importSettings.isPending}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}
