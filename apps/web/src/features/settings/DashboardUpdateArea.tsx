"use client";

import { Button, ConfirmDialog, StatusChip } from "@friday/ui";
import { Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n";
import { installDashboardUpdate, useDashboardUpdateStatus } from "@/lib/api/dashboardUpdate";
import { useSettingsDrafts } from "./SettingsDrafts";

export function DashboardUpdateArea() {
  const { t } = useT();
  const { role } = useSettingsDrafts();
  const status = useDashboardUpdateStatus(role === "owner");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const data = status.data;
  const install = async (): Promise<void> => {
    if (!data?.latest) return;
    setBusy(true);
    setFailure(null);
    try { await installDashboardUpdate(data.latest); await status.refetch(); }
    catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); setConfirm(false); }
  };
  if (role !== "owner") return null;
  return <section className="st-section" aria-labelledby="dashboard-update-title">
    <div className="st-section__head"><div>
      <h3 className="st-section__title" id="dashboard-update-title">{t("settings.update.title")}</h3>
      <p className="st-section__desc">{t("settings.update.desc")}</p>
    </div><Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} loading={status.isFetching} onClick={() => void status.refetch()}>{t("settings.update.check")}</Button></div>
    {data?.installing ? <StatusChip tone="amber">{t("settings.update.installing")}</StatusChip>
      : data?.available ? <StatusChip tone="amber" pulse>{t("settings.update.available")}</StatusChip>
      : data?.error ? <StatusChip tone="amber">{t("settings.update.unknown")}</StatusChip>
      : <StatusChip tone="green">{t("settings.update.current")}</StatusChip>}
    <p className="st-muted">{t("settings.update.installed")}: {data?.installed?.slice(0, 12) ?? "—"} · {t("settings.update.latest")}: {data?.latest?.slice(0, 12) ?? "—"}</p>
    {data?.installed && data.latest && data.installed !== data.latest ? <p className="st-muted"><a
      href={`https://github.com/rogueki/rogue-friday/compare/${data.installed}...${data.latest}`}
      target="_blank" rel="noopener noreferrer">{t("settings.update.changes")}</a></p> : null}
    {data?.error || status.error || failure ? <p className="st-error" role="alert">{failure ?? data?.error ?? (status.error instanceof Error ? status.error.message : String(status.error))}</p> : null}
    {data?.lastResult?.status === "failed" && !data.installing ? <p className="st-error" role="alert">{t("settings.update.failed")}: {data.lastResult.message}</p> : null}
    {data?.available && !data.installing ? <Button icon={<Download size={15} />} disabled={busy} onClick={() => setConfirm(true)}>{t("settings.update.install")}</Button> : null}
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={t("settings.update.confirmTitle")} description={t("settings.update.confirmDesc")}
      details={[`${data?.installed?.slice(0, 12) ?? "—"} → ${data?.latest?.slice(0, 12) ?? "—"}`]}
      confirmLabel={t("settings.update.install")} cancelLabel={t("common.cancel")} loading={busy} onConfirm={() => void install()} />
  </section>;
}
