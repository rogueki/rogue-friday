"use client";

import { Button, ConfirmDialog, StatusChip } from "@friday/ui";
import { Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { installDashboardUpdate, useDashboardUpdateStatus } from "@/lib/api/dashboardUpdate";
import { useSettingsDrafts } from "./SettingsDrafts";

function rememberRun(value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem("friday-dashboard-update-run");
    else sessionStorage.setItem("friday-dashboard-update-run", value);
  } catch { /* Browser storage may be disabled; live polling still works. */ }
}

function hasRememberedRun(): boolean {
  try { return sessionStorage.getItem("friday-dashboard-update-run") !== null; }
  catch { return false; }
}

export function DashboardUpdateArea() {
  const { t } = useT();
  const { role } = useSettingsDrafts();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [rememberedRun, setRememberedRun] = useState(false);
  const [priorRunId, setPriorRunId] = useState<string | null>(null);
  const status = useDashboardUpdateStatus(role === "owner", busy || rememberedRun);
  const data = status.data;
  const progress = data?.progress && !(data.progress.runId === priorRunId && (busy || rememberedRun)) ? data.progress : null;
  useEffect(() => {
    setRememberedRun(hasRememberedRun());
  }, []);
  useEffect(() => {
    if (progress?.state === "running") {
      rememberRun(progress.runId);
      setRememberedRun(true);
    } else if (progress?.state === "success" || progress?.state === "failed") {
      rememberRun(null);
      setRememberedRun(false);
    } else if (data && !busy && !status.isError) {
      rememberRun(null);
      setRememberedRun(false);
    }
  }, [progress?.runId, progress?.state, data, busy, status.isError]);
  const install = async (): Promise<void> => {
    if (!data?.latest) return;
    setConfirm(false);
    setBusy(true);
    setFailure(null);
    setPriorRunId(data.progress?.runId ?? null);
    rememberRun("pending");
    setRememberedRun(true);
    try {
      await installDashboardUpdate(data.latest);
      setRememberedRun(true);
      await status.refetch();
    } catch (error) {
      const check = await status.refetch();
      if (!check.data?.installing) setFailure(error instanceof Error ? error.message : String(error));
    }
    finally { setBusy(false); setConfirm(false); }
  };
  const checkNow = async (): Promise<void> => {
    setChecking(true);
    setFailure(null);
    try { await status.refresh(); }
    catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
    finally { setChecking(false); }
  };
  if (role !== "owner") return null;
  const reconnecting = (rememberedRun || data?.installing) && status.isError;
  const steps = [
    t("settings.update.stepDownload"), t("settings.update.stepVerify"), t("settings.update.stepDependencies"),
    t("settings.update.stepBuild"), t("settings.update.stepBackup"), t("settings.update.stepInstall"),
    t("settings.update.stepHealth"), t("settings.update.stepDone"),
  ];
  return <section className="st-section" aria-labelledby="dashboard-update-title">
    <div className="st-section__head"><div>
      <h3 className="st-section__title" id="dashboard-update-title">{t("settings.update.title")}</h3>
      <p className="st-section__desc">{t("settings.update.desc")}</p>
    </div><Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} loading={checking || status.isFetching} onClick={() => void checkNow()}>{t("settings.update.check")}</Button></div>
    {data?.installing || busy || reconnecting ? <StatusChip tone="amber">{t("settings.update.installing")}</StatusChip>
      : progress?.state === "failed" ? <StatusChip tone="amber">{t("settings.update.failed")}</StatusChip>
      : !data || status.isError || data.error || failure ? <StatusChip tone="amber">{t("settings.update.unknown")}</StatusChip>
      : data?.available ? <StatusChip tone="amber" pulse>{t("settings.update.available")}</StatusChip>
      : data?.lastResult?.status === "failed" ? <StatusChip tone="amber">{t("settings.update.failed")}</StatusChip>
      : <StatusChip tone="green">{t("settings.update.current")}</StatusChip>}
    {progress ? <div className="st-update-progress" aria-live="polite" aria-atomic="true">
      <p className="st-update-progress__heading">{progress.phase === "rollback" ? t("settings.update.rollback")
        : progress.state === "running" ? `${t("settings.update.step")} ${progress.step}/${progress.totalSteps}`
        : progress.state === "success" ? t("settings.update.done") : t("settings.update.failed")}</p>
      <p className="st-muted">{progress.message}</p>
      {progress.state === "running" && progress.phase !== "rollback" ? <>
        <progress className="st-update-progress__bar" value={progress.step ? progress.step - 1 : 0} max={progress.totalSteps} aria-label={t("settings.update.completedSteps")} />
        <ol className="st-update-progress__steps">{steps.map((label, index) => <li key={label} className={index + 1 === progress.step ? "st-update-progress__step--active" : index + 1 < progress.step ? "st-update-progress__step--done" : ""}>{label}</li>)}</ol>
        <p className="st-muted">{t("settings.update.lastActivity")}: {new Date(progress.updatedAt).toLocaleTimeString()}</p>
      </> : null}
    </div> : null}
    {busy && !progress?.runId ? <p className="st-muted" role="status">{t("settings.update.starting")}</p> : null}
    {data?.installing && !progress ? <p className="st-muted" role="status">{t("settings.update.legacyRunning")}</p> : null}
    {reconnecting ? <p className="st-muted" role="status">{t("settings.update.reconnecting")}</p> : null}
    <p className="st-muted">{t("settings.update.installed")}: {data?.installed?.slice(0, 12) ?? "—"} · {t("settings.update.latest")}: {data?.latest?.slice(0, 12) ?? "—"}</p>
    {data?.installed && data.latest && data.installed !== data.latest ? <p className="st-muted"><a
      href={`https://github.com/rogueki/rogue-friday/compare/${data.installed}...${data.latest}`}
      target="_blank" rel="noopener noreferrer">{t("settings.update.changes")}</a></p> : null}
    {data?.error || failure || status.error && !reconnecting ? <p className="st-error" role="alert">{failure ?? data?.error ?? (status.error instanceof Error ? status.error.message : String(status.error))}</p> : null}
    {progress?.state === "failed" ? <p className="st-error" role="alert">{progress.message}</p>
      : !progress && data?.lastResult?.status === "failed" && !data.installing ? <p className="st-error" role="alert">{t("settings.update.failed")}: {data.lastResult.message}</p> : null}
    {data?.available && !data.installing && !data.error && !failure ? <Button icon={<Download size={15} />} disabled={busy || rememberedRun} onClick={() => setConfirm(true)}>{t("settings.update.install")}</Button> : null}
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={t("settings.update.confirmTitle")} description={t("settings.update.confirmDesc")}
      details={[`${data?.installed?.slice(0, 12) ?? "—"} → ${data?.latest?.slice(0, 12) ?? "—"}`]}
      confirmLabel={t("settings.update.install")} cancelLabel={t("common.cancel")} loading={busy} onConfirm={() => void install()} />
  </section>;
}
