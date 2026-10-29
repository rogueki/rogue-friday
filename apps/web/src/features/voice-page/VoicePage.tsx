"use client";

import type { LatencyStat, VoiceDevice, VoiceProfile, VoiceStatus, VoiceTestKind, VoiceTestResult } from "@friday/sdk";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconTile,
  MetricCard,
  StatusChip,
  TagPill,
  TextField,
  useToast,
  type Tone,
} from "@friday/ui";
import {
  AudioLines,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Cpu,
  Fingerprint,
  Headphones,
  KeyRound,
  Lock,
  Mic,
  MicOff,
  Radio,
  Route,
  ShieldCheck,
  Speaker,
  Square,
  Trash2,
  UserCheck,
  Volume2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { KeyValue, StatusStrip, useFormatters, useQueryPanelState } from "@/features/system/common";
import { formatFraction, formatMs, MISSING } from "@/features/system/format";
import { useT, type MessageKey } from "@/i18n";
import { useDeleteVoiceHistory, useStopVoice, useVoiceDevices, useVoiceMetrics, useVoiceProfiles, useVoiceStatus, useVoiceTest } from "@/lib/api/domains/voice";
import { useModuleAvailability, useModulePanelGate } from "@/features/shared/useAvailability";
import { useCapability } from "@/lib/capabilities";
import { EnrollmentControls } from "./EnrollmentFlow";
import { LinuxEnrollment } from "./LinuxEnrollment";
import "./voice-page.css";

const ICON = { size: 18, strokeWidth: 1.5 } as const;

type PipelineState = "ready" | "busy" | "error" | "offline";

const PIPELINE_TONE: Record<PipelineState, Tone> = { ready: "green", busy: "cyan", error: "red", offline: "red" };

interface StatusRow {
  id: string;
  icon: LucideIcon;
  title: string;
  value: ReactNode;
  detail?: ReactNode;
  tone: Tone;
  stateLabel: string;
}

function deviceName(devices: VoiceDevice[] | undefined, id: string | null, none: string, missing: string): string {
  if (id === null) return none;
  if (devices !== undefined && !devices.some((device) => device.id === id)) return missing;
  return devices?.find((device) => device.id === id)?.name ?? id;
}

function deviceMissing(devices: VoiceDevice[] | undefined, id: string | null): boolean {
  return id !== null && devices !== undefined && !devices.some((device) => device.id === id);
}

/* ── Status (§38.1) ───────────────────────────────────────────────────── */

export function buildStatusRows(status: VoiceStatus, devices: VoiceDevice[] | undefined, t: (key: MessageKey, vars?: Record<string, string | number>) => string, locale: string, expires: string): StatusRow[] {
  const mic = status.microphone;
  const wake = status.wakeWord;
  const speaker = status.speakerVerification;
  const noDevice = t("voicePage.status.noDevice");
  const pipelineLabel = (state: PipelineState): string => t(`voicePage.pipeline.${state}` as MessageKey);
  const latency = (ms: number | null): string => (ms === null ? t("voicePage.noSource") : formatMs(ms, locale));
  return [
    {
      id: "microphone",
      icon: mic.active ? Mic : MicOff,
      title: t("voicePage.status.microphone"),
      value: t(`voicePage.mic.${mic.state}` as MessageKey),
      detail: deviceName(devices, mic.deviceId, noDevice, t("voicePage.status.deviceMissing")),
      tone: mic.state === "listening" ? "cyan" : mic.state === "idle" ? "green" : "muted",
      stateLabel: mic.active ? t("voicePage.mic.activeNow") : t("voicePage.mic.inactive"),
    },
    {
      id: "wakeWord",
      icon: Radio,
      title: t("voicePage.status.wakeWord"),
      value: wake.enabled ? `„${wake.phrase}“` : t("voicePage.disabled"),
      detail: t(`voicePage.wake.${wake.state}` as MessageKey),
      tone: wake.state === "armed" ? "green" : wake.state === "triggered" ? "cyan" : wake.state === "error" ? "red" : "muted",
      stateLabel: t(`voicePage.wake.${wake.state}` as MessageKey),
    },
    {
      id: "speaker",
      icon: Fingerprint,
      title: t("voicePage.status.speakerVerification"),
      value: t(`voicePage.speaker.${speaker.state}` as MessageKey),
      detail: speaker.confidence === null ? undefined : t("voicePage.speaker.confidence", { value: formatFraction(speaker.confidence, locale) }),
      tone: speaker.state === "verified" ? "green" : speaker.state === "rejected" ? "red" : speaker.state === "verifying" ? "cyan" : "muted",
      stateLabel: speaker.enabled ? t("voicePage.enabled") : t("voicePage.disabled"),
    },
    {
      id: "recognizedSpeaker",
      icon: UserCheck,
      title: t("voicePage.status.recognizedSpeaker"),
      value: speaker.recognizedSpeaker ?? MISSING,
      detail: speaker.recognizedSpeaker === null ? t("voicePage.status.noSpeaker") : undefined,
      tone: speaker.recognizedSpeaker ? "green" : "muted",
      stateLabel: speaker.recognizedSpeaker ? t("voicePage.speaker.verified") : t("voicePage.status.unknown"),
    },
    {
      id: "trustedSession",
      icon: ShieldCheck,
      title: t("voicePage.status.trustedSession"),
      value: status.trustedSession.active ? t("voicePage.active") : t("voicePage.inactive"),
      detail: status.trustedSession.active && status.trustedSession.expiresAt ? t("voicePage.trusted.until", { time: expires }) : undefined,
      tone: status.trustedSession.active ? "green" : "muted",
      stateLabel: status.trustedSession.active ? t("voicePage.active") : t("voicePage.inactive"),
    },
    {
      id: "stt",
      icon: AudioLines,
      title: t("voicePage.status.stt"),
      value: status.stt.engine,
      detail: latency(status.stt.latencyMs),
      tone: PIPELINE_TONE[status.stt.state],
      stateLabel: pipelineLabel(status.stt.state),
    },
    {
      id: "tts",
      icon: Volume2,
      title: t("voicePage.status.tts"),
      value: status.tts.engine,
      detail: latency(status.tts.latencyMs),
      tone: PIPELINE_TONE[status.tts.state],
      stateLabel: pipelineLabel(status.tts.state),
    },
    {
      id: "localModel",
      icon: BrainCircuit,
      title: t("voicePage.status.localModel"),
      value: status.localModel.name ?? MISSING,
      detail: latency(status.localModel.latencyMs),
      tone: PIPELINE_TONE[status.localModel.state],
      stateLabel: pipelineLabel(status.localModel.state),
    },
    {
      id: "input",
      icon: Headphones,
      title: t("voicePage.status.audioInput"),
      value: deviceName(devices, status.audioInputDeviceId, noDevice, t("voicePage.status.deviceMissing")),
      tone: deviceMissing(devices, status.audioInputDeviceId) ? "amber" : status.audioInputDeviceId ? "green" : "muted",
      stateLabel: deviceMissing(devices, status.audioInputDeviceId) ? t("voicePage.status.unreachable") : status.audioInputDeviceId ? t("voicePage.status.selected") : t("voicePage.status.noDevice"),
    },
    {
      id: "output",
      icon: Speaker,
      title: t("voicePage.status.audioOutput"),
      value: deviceName(devices, status.audioOutputDeviceId, noDevice, t("voicePage.status.deviceMissing")),
      tone: deviceMissing(devices, status.audioOutputDeviceId) ? "amber" : status.audioOutputDeviceId ? "green" : "muted",
      stateLabel: deviceMissing(devices, status.audioOutputDeviceId) ? t("voicePage.status.unreachable") : status.audioOutputDeviceId ? t("voicePage.status.selected") : t("voicePage.status.noDevice"),
    },
    {
      id: "audioPath",
      icon: Route,
      title: t("voicePage.status.audioPath"),
      value: status.audioPath ? t(`voicePage.audioPath.${status.audioPath.transport === "browser" ? "browser" : status.audioPath.host ?? "device"}` as MessageKey) : t("voicePage.status.unknown"),
      tone: status.audioPath ? "cyan" : "muted",
      stateLabel: status.audioPath ? t("voicePage.audioPath.active") : t("voicePage.status.unknown"),
    },
    {
      id: "pushToTalk",
      icon: KeyRound,
      title: t("voicePage.status.pushToTalk"),
      value: status.pushToTalk.enabled ? (status.pushToTalk.active ? t("voicePage.active") : t("voicePage.enabled")) : t("voicePage.disabled"),
      tone: status.pushToTalk.active ? "cyan" : status.pushToTalk.enabled ? "green" : "muted",
      stateLabel: status.pushToTalk.enabled ? t("voicePage.enabled") : t("voicePage.disabled"),
    },
    {
      id: "focus",
      icon: Cpu,
      title: t("voicePage.status.focusMode"),
      value: status.focusMode ? t("voicePage.active") : t("voicePage.inactive"),
      tone: status.focusMode ? "amber" : "muted",
      stateLabel: status.focusMode ? t("voicePage.active") : t("voicePage.inactive"),
    },
  ];
}

/** Microphone activity is always visible on this page (PLAN §38.4), independent of every panel state. */
function MicActivityBanner() {
  const { t } = useT();
  const query = useVoiceStatus();
  const status = query.data?.data;
  const availability = useModuleAvailability("voice", { error: query.error });
  // Cached data of an unreachable service is not "known": the banner must not claim the microphone is idle.
  const known = Boolean(status) && availability.kind === "ok";
  const active = known && (status?.microphone.active ?? false);
  // Unknown is not "service offline": say which of the two it is.
  const unknownHint =
    availability.kind === "outage" ? t("voice.nav.offline") : availability.kind === "not-configured" ? t("voice.nav.notConfigured") : t("voicePage.mic.unknownHint");
  return (
    <div className={`vp-mic${active ? " vp-mic--active" : ""}`} role="status" aria-live="polite" data-testid="mic-activity">
      <IconTile icon={active ? <Mic size={16} strokeWidth={1.5} /> : <MicOff size={16} strokeWidth={1.5} />} tone={!known ? "muted" : active ? "red" : "green"} size="sm" active={active} />
      <span className="vp-mic__text">
        <strong>{!known ? t("voicePage.mic.unknown") : active ? t("voicePage.mic.recording") : t("voicePage.mic.notRecording")}</strong>
        <span className="mc-muted">{!known ? unknownHint : t("voicePage.mic.alwaysVisible")}</span>
      </span>
    </div>
  );
}

function StatusPanel() {
  const { t, locale } = useT();
  const { toast } = useToast();
  const formatters = useFormatters();
  const query = useVoiceStatus();
  const devicesQuery = useVoiceDevices();
  const stop = useStopVoice();
  const canStop = useCapability("voice", "stop");
  const status = query.data?.data;
  const state = useQueryPanelState(query, { module: "voice", freshness: query.data?.freshness });
  const rows = status ? buildStatusRows(status, devicesQuery.data?.items, t, locale, formatters.dateTime(status.trustedSession.expiresAt)) : [];
  const speaking = status?.mode === "speaking";
  return (
    <PanelFrame
      title={t("voicePage.status.title")}
      subtitle={status ? t("voicePage.status.mode", { mode: t(`voicePage.mode.${status.mode}` as MessageKey) }) : undefined}
      icon={<Mic {...ICON} />}
      actions={<StatusStrip freshness={query.data?.freshness} source={status?.source.system} />}
      state={state}
      skeletonRows={6}
    >
      <div className="mc-stack">
        <div className="mc-toolbar">
          <Button
            size="sm"
            variant="danger"
            icon={<Square size={13} strokeWidth={1.5} />}
            disabled={!canStop || !status || status.mode === "idle"}
            loading={stop.isPending}
            title={!canStop ? t("voicePage.action.unavailable", { capability: "voice.stop" }) : status?.mode === "idle" ? t("voicePage.stop.idle") : undefined}
            onClick={() =>
              stop.mutate(
                {},
                { onSuccess: (result) => toast({ title: t("voicePage.stop.done"), description: result.message, tone: "green" }) },
              )
            }
          >
            {speaking ? t("voicePage.stop.speech") : t("voicePage.stop.label")}
          </Button>
          {canStop ? null : <span className="mc-note mc-note--muted">{t("voicePage.action.unavailable", { capability: "voice.stop" })}</span>}
        </div>
        <ul className="vp-status">
          {rows.map((row) => (
            <li key={row.id} className="vp-status__row">
              <IconTile icon={<row.icon size={16} strokeWidth={1.5} />} tone={row.tone} size="sm" />
              <span className="vp-status__text">
                <span className="vp-status__title">{row.title}</span>
                <strong className="vp-status__value">{row.value}</strong>
                {row.detail ? <span className="mc-muted vp-status__detail">{row.detail}</span> : null}
              </span>
              <StatusChip tone={row.tone}>{row.stateLabel}</StatusChip>
            </li>
          ))}
        </ul>
      </div>
    </PanelFrame>
  );
}

/* ── Live metrics (§38.2) ─────────────────────────────────────────────── */

const METRICS: { key: "wakeWordLatency" | "speakerVerificationLatency" | "sttLatency" | "routerLatency" | "firstToken" | "ttsFirstAudio"; label: MessageKey }[] = [
  { key: "wakeWordLatency", label: "voicePage.metric.wakeWord" },
  { key: "speakerVerificationLatency", label: "voicePage.metric.speaker" },
  { key: "sttLatency", label: "voicePage.metric.stt" },
  { key: "routerLatency", label: "voicePage.metric.router" },
  { key: "firstToken", label: "voicePage.metric.firstToken" },
  { key: "ttsFirstAudio", label: "voicePage.metric.ttsFirstAudio" },
];

/** A latency tile; a missing current value stays "—" with the reason, avg/p95 only appear when the source measured them. */
export function LatencyTile({ label, stat }: { label: string; stat: LatencyStat }) {
  const { t, locale } = useT();
  const measured = stat.currentMs !== null && Number.isFinite(stat.currentMs);
  const hint = measured
    ? [stat.avgMs === null ? null : t("voicePage.metric.avg", { value: formatMs(stat.avgMs, locale) }), stat.p95Ms === null ? null : t("voicePage.metric.p95", { value: formatMs(stat.p95Ms, locale) }), t("voicePage.metric.samples", { count: stat.sampleCount })]
        .filter(Boolean)
        .join(" · ")
    : t("voicePage.metric.noMeasurement");
  return (
    <MetricCard
      label={label}
      value={measured ? new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 0 }).format(stat.currentMs ?? 0) : null}
      unit={measured ? "ms" : undefined}
      icon={<Clock size={16} strokeWidth={1.5} />}
      hint={hint}
      nullReason={t("voicePage.noSourceReason")}
      tone={measured ? "cyan" : "muted"}
    />
  );
}

function MetricsPanel() {
  const { t } = useT();
  const query = useVoiceMetrics();
  const metrics = query.data?.data;
  const state = useQueryPanelState(query, { module: "voice", freshness: query.data?.freshness });
  return (
    <PanelFrame
      title={t("voicePage.metrics.title")}
      subtitle={t("voicePage.metrics.subtitle")}
      icon={<Clock {...ICON} />}
      actions={<StatusStrip freshness={query.data?.freshness} source={metrics?.source.system} />}
      state={state}
      skeletonRows={3}
    >
      {metrics ? (
        <div className="mc-grid mc-grid--3 vp-metrics">
          {METRICS.map((entry) => (
            <LatencyTile key={entry.key} label={t(entry.label)} stat={metrics[entry.key]} />
          ))}
        </div>
      ) : null}
    </PanelFrame>
  );
}

/* ── Enrollment (§38.3) ───────────────────────────────────────────────── */

function ProfileCard({ profile, canEnroll }: { profile: VoiceProfile; canEnroll: boolean }) {
  const { t, locale } = useT();
  const formatters = useFormatters();
  const result: Record<VoiceProfile["lastTestResult"], { tone: Tone; label: string; icon: ReactNode }> = {
    pass: { tone: "green", label: t("voicePage.profile.pass"), icon: <CheckCircle2 size={13} strokeWidth={1.5} /> },
    fail: { tone: "red", label: t("voicePage.profile.fail"), icon: <XCircle size={13} strokeWidth={1.5} /> },
    unknown: { tone: "muted", label: t("voicePage.profile.untested"), icon: null },
  };
  const last = result[profile.lastTestResult];
  return (
    <li className="vp-profile">
      <div className="mc-row mc-row--between">
        <strong>{profile.displayName}</strong>
        <span className="mc-row">
          {profile.owner ? <TagPill tone="gold">{t("voicePage.profile.owner")}</TagPill> : null}
          <StatusChip tone={last.tone} icon={last.icon} dot={last.icon === null}>
            {last.label}
          </StatusChip>
        </span>
      </div>
      <dl className="mc-kvlist">
        <KeyValue label={t("voicePage.profile.samples")} mono>
          {String(profile.sampleCount)}
        </KeyValue>
        <KeyValue label={t("voicePage.profile.quality")} mono>
          {formatFraction(profile.quality, locale)}
        </KeyValue>
        <KeyValue label={t("voicePage.profile.threshold")} mono>
          {formatFraction(profile.threshold, locale)}
        </KeyValue>
        <KeyValue label={t("voicePage.profile.calibrated")} reason={t("voicePage.profile.notCalibrated")}>
          {profile.calibratedAt ? formatters.dateTime(profile.calibratedAt) : null}
        </KeyValue>
        <KeyValue label={t("voicePage.profile.lastTest")} reason={t("voicePage.profile.neverTested")}>
          {profile.lastTestAt ? formatters.dateTime(profile.lastTestAt) : null}
        </KeyValue>
      </dl>
      {canEnroll ? <EnrollmentControls profile={profile} /> : null}
    </li>
  );
}

function EnrollmentPanel() {
  const { t } = useT();
  const query = useVoiceProfiles();
  const canEnroll = useCapability("voice", "enroll");
  const profiles = query.data?.items ?? [];
  const state = useQueryPanelState(query, {
    module: "voice",
    empty: query.isSuccess && profiles.length === 0,
    emptyTitle: t("voicePage.enrollment.empty"),
    emptyDescription: t("voicePage.enrollment.emptyDescription"),
    emptyIcon: <Fingerprint {...ICON} />,
    freshness: query.data?.freshness,
  });
  return (
    <PanelFrame
      title={t("voicePage.enrollment.title")}
      subtitle={t("voicePage.enrollment.subtitle")}
      icon={<Fingerprint {...ICON} />}
      state={state}
      skeletonRows={3}
    >
      <div className="mc-stack">
        <div className="mc-strip-row">
          <StatusStrip freshness={query.data?.freshness} source={query.data?.sources[0]?.system} />
        </div>
        {canEnroll ? null : (
          <div className="mc-box mc-box--amber" role="note" data-testid="enrollment-readonly">
            <strong>{t("voicePage.enrollment.readOnly")}</strong>
            <p className="mc-note">{t("voicePage.enrollment.readOnlyDescription")}</p>
          </div>
        )}
        <ul className="mc-list">
          {profiles.map((profile) => (
            <ProfileCard key={profile.id} profile={profile} canEnroll={canEnroll} />
          ))}
        </ul>
      </div>
    </PanelFrame>
  );
}

/* ── Privacy (§38.4) ──────────────────────────────────────────────────── */

function PrivacyPanel() {
  const { t } = useT();
  const router = useRouter();
  const query = useVoiceStatus();
  const status = query.data?.data;
  const state = useQueryPanelState(query, { module: "voice", freshness: query.data?.freshness });
  const canDelete = useCapability("voice", "deleteHistory");
  const { toast } = useToast();
  const deleteHistory = useDeleteVoiceHistory();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const runDelete = (): void =>
    deleteHistory.mutate(
      {},
      {
        onSuccess: (result) => {
          setConfirmDelete(false);
          toast({ title: t("voicePage.privacy.deleted"), description: result.message, tone: "green" });
        },
        onError: () => setConfirmDelete(false),
      },
    );
  const flag = (on: boolean, onLabel: string, offLabel: string): ReactNode => <StatusChip tone={on ? "amber" : "green"}>{on ? onLabel : offLabel}</StatusChip>;
  return (
    <PanelFrame title={t("voicePage.privacy.title")} icon={<Lock {...ICON} />} state={state} skeletonRows={3}>
      {status ? (
        <div className="mc-stack">
          <ul className="mc-list">
            <li className="vp-privacy">
              <span>
                <strong>{t("voicePage.privacy.raw")}</strong>
                <span className="mc-muted vp-privacy__hint">{t("voicePage.privacy.rawHint")}</span>
              </span>
              {flag(status.rawRecordingEnabled, t("voicePage.privacy.rawOn"), t("voicePage.privacy.rawOff"))}
            </li>
            <li className="vp-privacy">
              <span>
                <strong>{t("voicePage.privacy.history")}</strong>
                <span className="mc-muted vp-privacy__hint">{t("voicePage.privacy.historyHint")}</span>
              </span>
              {flag(status.voiceHistoryEnabled, t("voicePage.privacy.historyOn"), t("voicePage.privacy.historyOff"))}
            </li>
            <li className="vp-privacy">
              <span>
                <strong>{t("voicePage.privacy.mic")}</strong>
                <span className="mc-muted vp-privacy__hint">{t("voicePage.privacy.micHint")}</span>
              </span>
              <StatusChip tone={status.microphone.active ? "red" : "green"} pulse={status.microphone.active}>
                {status.microphone.active ? t("voicePage.mic.recording") : t("voicePage.mic.notRecording")}
              </StatusChip>
            </li>
          </ul>
          <div className="mc-toolbar">
            <Button size="sm" variant="ghost" onClick={() => router.push("/settings")}>
              {t("voicePage.privacy.settings")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={14} strokeWidth={1.5} />}
              disabled={!canDelete}
              title={canDelete ? undefined : t("voicePage.privacy.deleteUnavailable")}
              onClick={() => setConfirmDelete(true)}
            >
              {t("voicePage.privacy.delete")}
            </Button>
          </div>
          {canDelete ? null : <p className="mc-note mc-note--muted">{t("voicePage.privacy.deleteUnavailable")}</p>}
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            tone="danger"
            title={t("voicePage.privacy.deleteConfirm.title")}
            description={t("voicePage.privacy.deleteConfirm.description")}
            details={[t("voicePage.privacy.deleteConfirm.final"), t("voicePage.privacy.deleteConfirm.profiles"), t("voicePage.privacy.deleteConfirm.audit")]}
            confirmLabel={t("voicePage.privacy.deleteConfirm.confirm")}
            cancelLabel={t("common.cancel")}
            loading={deleteHistory.isPending}
            onConfirm={runDelete}
          />
        </div>
      ) : null}
    </PanelFrame>
  );
}

/* ── Test mode (§38.5) ────────────────────────────────────────────────── */

const TEST_KINDS: { kind: VoiceTestKind; label: MessageKey }[] = [
  { kind: "wake_word", label: "voicePage.test.wakeWord" },
  { kind: "speaker", label: "voicePage.test.speaker" },
  { kind: "stt", label: "voicePage.test.stt" },
  { kind: "tts", label: "voicePage.test.tts" },
  { kind: "full_pipeline", label: "voicePage.test.fullPipeline" },
];

function TestResult({ result }: { result: VoiceTestResult }) {
  const { t, locale } = useT();
  return (
    <div className="mc-stack" role="status" aria-live="polite" data-testid="voice-test-result">
      <div className="mc-row">
        <StatusChip tone={result.success ? "green" : "red"} icon={result.success ? <CheckCircle2 size={13} strokeWidth={1.5} /> : <XCircle size={13} strokeWidth={1.5} />} dot={false}>
          {result.success ? t("voicePage.test.success") : t("voicePage.test.failed")}
        </StatusChip>
        <span className="mc-muted">{t(`voicePage.test.kind.${result.kind}` as MessageKey)} · {formatMs(result.durationMs, locale)}</span>
      </div>
      <p className="mc-note">{result.message}</p>
      <ul className="mc-list">
        {result.stages.map((stage) => (
          <li key={stage.name} className="vp-stage">
            <span className="mc-row">
              {stage.ok ? <CheckCircle2 size={14} strokeWidth={1.5} aria-hidden="true" className="vp-ok" /> : <XCircle size={14} strokeWidth={1.5} aria-hidden="true" className="vp-fail" />}
              <strong>{stage.name}</strong>
              <span className="mc-muted">{stage.ok ? t("voicePage.test.stageOk") : t("voicePage.test.stageFailed")}</span>
            </span>
            <span className="mc-mono">{stage.latencyMs === null ? MISSING : formatMs(stage.latencyMs, locale)}</span>
            {stage.detail ? <span className="mc-muted vp-stage__detail">{stage.detail}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TestPanel() {
  const { t } = useT();
  const canTest = useCapability("voice", "test");
  // The panel has no query of its own, but the test needs the adapter: outage / not connected replace the form.
  const gate = useModulePanelGate("voice", { moduleName: t("nav.voice") });
  const test = useVoiceTest();
  const [text, setText] = useState("");
  const [running, setRunning] = useState<VoiceTestKind | null>(null);
  const run = (kind: VoiceTestKind): void => {
    setRunning(kind);
    const body = kind === "tts" && text.trim() ? { kind, text: text.trim() } : { kind };
    test.mutate(body, { onSettled: () => setRunning(null) });
  };
  return (
    <PanelFrame title={t("voicePage.test.title")} subtitle={t("voicePage.test.subtitle")} icon={<AudioLines {...ICON} />} state={gate.state ?? { kind: "ready", outage: gate.outage }}>
      <div className="mc-stack">
        {canTest ? null : (
          <div className="mc-box mc-box--amber" role="note" data-testid="test-unavailable">
            {t("voicePage.action.unavailable", { capability: "voice.test" })}
          </div>
        )}
        <TextField label={t("voicePage.test.text")} hint={t("voicePage.test.textHint")} value={text} maxLength={200} onChange={(event) => setText(event.target.value)} disabled={!canTest} />
        <div className="mc-toolbar" role="group" aria-label={t("voicePage.test.title")}>
          {TEST_KINDS.map((entry) => (
            <Button
              key={entry.kind}
              size="sm"
              variant={entry.kind === "full_pipeline" ? "primary" : "ghost"}
              disabled={!canTest || running !== null}
              loading={running === entry.kind}
              onClick={() => run(entry.kind)}
            >
              {t(entry.label)}
            </Button>
          ))}
        </div>
        {test.isError ? (
          <div className="mc-box mc-box--amber" role="alert">
            {test.error.message}
          </div>
        ) : null}
        {test.data ? <TestResult result={test.data.data} /> : <p className="mc-note mc-note--muted">{t("voicePage.test.noResult")}</p>}
      </div>
    </PanelFrame>
  );
}

/* ── Devices ──────────────────────────────────────────────────────────── */

function DevicesPanel() {
  const { t } = useT();
  const query = useVoiceDevices();
  const devices = useMemo(() => query.data?.items ?? [], [query.data]);
  const state = useQueryPanelState(query, {
    module: "voice",
    empty: query.isSuccess && devices.length === 0,
    emptyTitle: t("voicePage.devices.empty"),
    emptyIcon: <Headphones {...ICON} />,
    freshness: query.data?.freshness,
  });
  const groups = useMemo(() => [
    { id: "input", title: t("voicePage.devices.input"), items: devices.filter((device) => device.kind === "input") },
    { id: "output", title: t("voicePage.devices.output"), items: devices.filter((device) => device.kind === "output") },
  ], [devices, t]);
  return (
    <PanelFrame
      title={t("voicePage.devices.title")}
      icon={<Headphones {...ICON} />}
      state={state}
      skeletonRows={3}
    >
      <div className="mc-stack">
        <div className="mc-strip-row">
          <StatusStrip freshness={query.data?.freshness} source={query.data?.sources[0]?.system} />
        </div>
        {groups.map((group) => (
          <section key={group.id} aria-label={group.title}>
            <h3 className="mc-subtitle">{group.title}</h3>
            {group.items.length === 0 ? (
              <EmptyState compact title={t("voicePage.devices.none")} />
            ) : (
              <ul className="mc-list">
                {group.items.map((device) => (
                  <li key={device.id} className="vp-device">
                    <span className="vp-device__name">{device.name}</span>
                    <span className="mc-row">
                      {device.isDefault ? <TagPill tone="cyan">{t("voicePage.devices.default")}</TagPill> : null}
                      <TagPill tone={device.status === "online" ? "green" : "muted"}>{t(`health.${device.status}` as MessageKey)}</TagPill>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </PanelFrame>
  );
}

export function VoicePage() {
  return (
    <div className="mc-page vp-page">
      <MicActivityBanner />
      <LinuxEnrollment />
      <div className="mc-grid vp-top">
        <StatusPanel />
        <div className="mc-stack">
          <MetricsPanel />
          <TestPanel />
        </div>
      </div>
      <div className="mc-grid mc-grid--3 vp-bottom">
        <EnrollmentPanel />
        <PrivacyPanel />
        <DevicesPanel />
      </div>
    </div>
  );
}
