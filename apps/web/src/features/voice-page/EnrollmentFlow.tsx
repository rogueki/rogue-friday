"use client";

import type { VoiceEnrollment, VoiceProfile } from "@jarvis/sdk";
import { Button, Dialog, StatusChip, Switch, TextField, type Tone } from "@jarvis/ui";
import { CheckCircle2, Fingerprint, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { formatFraction } from "@/features/system/format";
import { useT, type MessageKey } from "@/i18n";
import { isEnrollmentRunning, useStartEnrollment, useVoiceEnrollment } from "@/lib/api/domains/voice";

export const MIN_SAMPLES = 3;
export const MAX_SAMPLES = 50;
export const DEFAULT_SAMPLES = 12;

/** `null` when the text is a whole number in the contract range (3..50). */
export function validateSampleTarget(text: string): "invalid" | null {
  if (!/^\d+$/.test(text.trim())) return "invalid";
  const value = Number(text);
  return value >= MIN_SAMPLES && value <= MAX_SAMPLES ? null : "invalid";
}

const STATUS_TONE: Record<VoiceEnrollment["status"], Tone> = {
  queued: "muted",
  capturing: "cyan",
  calibrating: "cyan",
  completed: "green",
  failed: "red",
  cancelled: "amber",
};

/** Live status of one enrollment job; polls until it is completed, failed or cancelled. */
export function EnrollmentProgress({ jobId, onDismiss }: { jobId: string; onDismiss: () => void }) {
  const { t, locale } = useT();
  const query = useVoiceEnrollment(jobId);
  const job = query.data?.data;
  if (!job) {
    return (
      <div className="vp-enroll" role="status" aria-live="polite">
        {query.isError ? <span className="vp-fail">{t("voicePage.enrollment.job.error")}</span> : <span className="mc-muted">{t("voicePage.enrollment.job.loading")}</span>}
      </div>
    );
  }
  const running = isEnrollmentRunning(job);
  const percent = Math.round((job.progress.value ?? 0) * 100);
  return (
    <div className="vp-enroll" role="status" aria-live="polite" data-testid="enrollment-job" data-status={job.status}>
      <div className="mc-row mc-row--between">
        <StatusChip tone={STATUS_TONE[job.status]} pulse={running}>
          {t(`voicePage.enrollment.status.${job.status}` as MessageKey)}
        </StatusChip>
        <span className="mc-mono">{t("voicePage.enrollment.job.samples", { done: job.samplesCaptured, total: job.samplesRequired })}</span>
      </div>
      {job.progress.mode === "determinate" ? (
        <progress className="vp-progress" value={percent} max={100} aria-label={t("voicePage.enrollment.job.progress")} />
      ) : null}
      {job.message ? <p className="mc-note">{job.message}</p> : null}
      {job.status === "completed" ? (
        <p className="mc-note vp-ok">
          <CheckCircle2 size={13} strokeWidth={1.5} aria-hidden="true" /> {t("voicePage.enrollment.job.done", { quality: formatFraction(job.quality, locale) })}
        </p>
      ) : null}
      {job.status === "failed" || job.status === "cancelled" ? (
        <p className="mc-note vp-fail">
          <XCircle size={13} strokeWidth={1.5} aria-hidden="true" /> {t("voicePage.enrollment.job.failed")}
        </p>
      ) : null}
      {running ? null : (
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t("voicePage.enrollment.job.dismiss")}
        </Button>
      )}
    </div>
  );
}

/** "Einlernen starten" for one profile: options dialog, then the live job status below the profile. */
export function EnrollmentControls({ profile }: { profile: VoiceProfile }) {
  const { t } = useT();
  const start = useStartEnrollment();
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [samples, setSamples] = useState(String(DEFAULT_SAMPLES));
  const [recalibrate, setRecalibrate] = useState(profile.calibratedAt === null);
  const invalid = validateSampleTarget(samples) !== null;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (invalid || start.isPending) return;
    start.mutate(
      { profileId: profile.id, sampleTarget: Number(samples), recalibrate },
      {
        onSuccess: (response) => {
          setJobId(response.data.id);
          setOpen(false);
        },
      },
    );
  };

  return (
    <div className="mc-stack">
      {jobId ? <EnrollmentProgress jobId={jobId} onDismiss={() => setJobId(null)} /> : null}
      <div className="mc-toolbar">
        <Button size="sm" variant="primary" icon={<Fingerprint size={14} strokeWidth={1.5} />} onClick={() => setOpen(true)}>
          {t("voicePage.enrollment.start")}
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("voicePage.enrollment.dialog.title", { name: profile.displayName })}
        description={t("voicePage.enrollment.dialog.description")}
        icon={<Fingerprint size={16} strokeWidth={1.5} />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={start.isPending}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" type="submit" form={`vp-enroll-${profile.id}`} loading={start.isPending} disabled={invalid}>
              {t("voicePage.enrollment.dialog.confirm")}
            </Button>
          </>
        }
      >
        <form id={`vp-enroll-${profile.id}`} className="mc-stack" onSubmit={submit}>
          <TextField
            label={t("voicePage.enrollment.dialog.samples")}
            hint={t("voicePage.enrollment.dialog.samplesHint", { min: MIN_SAMPLES, max: MAX_SAMPLES })}
            error={invalid ? t("voicePage.enrollment.dialog.samplesInvalid", { min: MIN_SAMPLES, max: MAX_SAMPLES }) : undefined}
            inputMode="numeric"
            value={samples}
            onChange={(event) => setSamples(event.target.value)}
          />
          <Switch
            label={t("voicePage.enrollment.dialog.recalibrate")}
            description={t("voicePage.enrollment.dialog.recalibrateHint")}
            checked={recalibrate}
            onCheckedChange={setRecalibrate}
            stateLabels={[t("voicePage.privacy.rawOn"), t("voicePage.privacy.rawOff")]}
          />
          <p className="mc-note mc-note--muted">{t("voicePage.enrollment.dialog.privacy")}</p>
        </form>
      </Dialog>
    </div>
  );
}
