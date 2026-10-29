"use client";

import type { AdapterInfo, HealthStatus, ModelProvider, Service, StorageVolume, SystemMetrics } from "@friday/sdk";
import {
  Button,
  CircularMetric,
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  HealthBadge,
  IconTile,
  ProviderCard,
  StatusChip,
  TagPill,
  useMediaQuery,
  useToast,
  type DataTableColumn,
  type ProviderStatus,
  type Tone,
} from "@friday/ui";
import { Activity, Cpu, FileText, Fingerprint, HardDrive, Network, PlugZap, RefreshCw, RotateCcw, Server, ShieldCheck, Sparkles, Thermometer, Waypoints } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { healthStateFromWire, toneFromHealth } from "@/features/shared/presentation";
import { useT, type MessageKey } from "@/i18n";
import {
  useAdapterHealthCheck,
  useAdapterReconnect,
  useAdapters,
  useModelProviders,
  useRestartAdapter,
  useServiceHealthcheck,
  useServices,
  useStorage,
  useSystemMetrics,
} from "@/lib/api/domains/system";
import { useSystemInstallation } from "@/lib/api/domains/system-installation";
import { useCapability } from "@/lib/capabilities";
import { useRealtimeStatus, type RealtimeStatus } from "@/lib/realtime/store";
import { AdapterLogsDialog } from "./AdapterLogs";
import { KeyValue, StatusStrip, useFormatters, useHealthLabels, useQueryPanelState } from "./common";
import { formatBytes, formatMs, formatPercent, formatRate, formatTemperature, MISSING } from "./format";
import "./system.css";

const ICON = { size: 18, strokeWidth: 1.5 } as const;

/* ── Hardware (§40.1) ─────────────────────────────────────────────────── */

function usageTone(percent: number | null | undefined): Tone {
  if (percent === null || percent === undefined) return "muted";
  return percent >= 90 ? "red" : percent >= 75 ? "amber" : "cyan";
}

interface TemperatureEntry {
  id: string;
  label: string;
  celsius: number;
}

function collectTemperatures(metrics: SystemMetrics, t: (key: MessageKey) => string): TemperatureEntry[] {
  const entries: TemperatureEntry[] = [];
  if (typeof metrics.cpu.temperatureC === "number") entries.push({ id: "cpu", label: t("system.hardware.cpu"), celsius: metrics.cpu.temperatureC });
  if (metrics.gpu && typeof metrics.gpu.temperatureC === "number") entries.push({ id: "gpu", label: t("system.hardware.gpu"), celsius: metrics.gpu.temperatureC });
  for (const sensor of metrics.temperatures ?? []) entries.push({ id: `sensor-${sensor.sensor}`, label: sensor.sensor, celsius: sensor.celsius });
  return entries;
}

function Gauge({ label, value, caption, nullReason }: { label: string; value: number | null; caption: string; nullReason?: string }) {
  return (
    <div className="sy-gauge">
      <CircularMetric label={label} value={value} size={104} tone={usageTone(value)} thresholds={[75, 90]} nullReason={nullReason} />
      <span className="sy-gauge__caption mc-muted" title={caption}>
        {caption}
      </span>
    </div>
  );
}

export function HardwarePanel() {
  const { t, locale } = useT();
  const query = useSystemMetrics();
  const metrics = query.data?.data;
  const state = useQueryPanelState(query, { module: "system", freshness: query.data?.freshness });
  const temperatures = metrics ? collectTemperatures(metrics, t) : [];
  const noGpu = t("system.hardware.noGpu");
  return (
    <PanelFrame
      title={t("system.hardware.title")}
      subtitle={metrics ? t("system.hardware.sampled", { time: new Date(metrics.sampledAt).toLocaleTimeString(locale === "de" ? "de-DE" : "en-GB") }) : undefined}
      icon={<Cpu {...ICON} />}
      actions={<StatusStrip freshness={query.data?.freshness} source={metrics?.source.system} />}
      state={state}
      skeletonRows={4}
    >
      {metrics ? (
        <div className="mc-stack">
          <div className="sy-gauges">
            <Gauge label={t("system.hardware.cpu")} value={metrics.cpu.usagePercent} caption={t("system.hardware.cores", { count: metrics.cpu.cores })} />
            <Gauge
              label={t("system.hardware.ram")}
              value={metrics.ram.usagePercent}
              caption={`${formatBytes(metrics.ram.usedBytes, locale)} / ${formatBytes(metrics.ram.totalBytes, locale)}`}
            />
            <Gauge
              label={t("system.hardware.gpu")}
              value={metrics.gpu ? metrics.gpu.usagePercent : null}
              nullReason={noGpu}
              caption={metrics.gpu ? metrics.gpu.name : t("system.hardware.noSource")}
            />
            <Gauge
              label={t("system.hardware.vram")}
              value={metrics.vram ? metrics.vram.usagePercent : null}
              nullReason={noGpu}
              caption={metrics.vram ? `${formatBytes(metrics.vram.usedBytes, locale)} / ${formatBytes(metrics.vram.totalBytes, locale)}` : t("system.hardware.noSource")}
            />
          </div>
          <div className="mc-grid mc-grid--2">
            <section aria-label={t("system.hardware.temperatures")}>
              <h3 className="mc-subtitle">
                <Thermometer size={12} strokeWidth={1.5} aria-hidden="true" /> {t("system.hardware.temperatures")}
              </h3>
              {temperatures.length === 0 ? (
                <p className="mc-note mc-note--muted">{t("system.hardware.noTemperatures")}</p>
              ) : (
                <ul className="mc-list">
                  {temperatures.map((entry) => (
                    <li key={entry.id} className="sy-line">
                      <span>{entry.label}</span>
                      <span className="mc-mono">{formatTemperature(entry.celsius, locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label={t("system.hardware.network")}>
              <h3 className="mc-subtitle">
                <Network size={12} strokeWidth={1.5} aria-hidden="true" /> {t("system.hardware.network")}
              </h3>
              <ul className="mc-list">
                <li className="sy-line">
                  <span>{t("system.hardware.rx")}</span>
                  <span className="mc-mono">{formatRate(metrics.network.rxBytesPerSec, locale)}</span>
                </li>
                <li className="sy-line">
                  <span>{t("system.hardware.tx")}</span>
                  <span className="mc-mono">{formatRate(metrics.network.txBytesPerSec, locale)}</span>
                </li>
                <li className="sy-line">
                  <span>{t("system.hardware.latency")}</span>
                  <span className="mc-mono" title={metrics.network.latencyMs == null ? t("system.hardware.noSource") : undefined}>
                    {formatMs(metrics.network.latencyMs, locale)}
                  </span>
                </li>
              </ul>
            </section>
          </div>
        </div>
      ) : null}
    </PanelFrame>
  );
}

/* ── Storage ──────────────────────────────────────────────────────────── */

function StorageRow({ volume }: { volume: StorageVolume }) {
  const { t, locale } = useT();
  const tone = usageTone(volume.usagePercent);
  return (
    <li className="sy-volume">
      <div className="sy-line">
        <span className="sy-volume__name">
          <IconTile icon={<HardDrive size={14} strokeWidth={1.5} />} tone={tone} size="xs" />
          <strong className="mc-mono">{volume.mount}</strong>
          <span className="mc-muted">{volume.label}</span>
        </span>
        <span className="mc-mono">{formatPercent(volume.usagePercent, locale)}</span>
      </div>
      <div
        className="sy-bar"
        role="progressbar"
        aria-label={`${volume.mount} ${volume.label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volume.usagePercent)}
      >
        <span className={`sy-bar__fill sy-bar__fill--${tone}`} style={{ width: `${Math.min(100, Math.max(0, volume.usagePercent))}%` }} />
      </div>
      <span className="mc-muted sy-volume__caption">
        {t("system.storage.caption", { free: formatBytes(volume.freeBytes, locale), total: formatBytes(volume.totalBytes, locale) })}
        {volume.fileSystem ? ` · ${volume.fileSystem}` : ""}
      </span>
    </li>
  );
}

export function StoragePanel() {
  const { t } = useT();
  const query = useStorage();
  const volumes = useMemo(() => query.data?.items ?? [], [query.data]);
  const state = useQueryPanelState(query, {
    module: "system",
    empty: query.isSuccess && volumes.length === 0,
    emptyTitle: t("system.storage.empty"),
    emptyIcon: <HardDrive {...ICON} />,
    freshness: query.data?.freshness,
  });
  // The friday data drive (D:\) comes first; everything else keeps the server order.
  const sorted = useMemo(() => [...volumes].sort((a, b) => Number(/^D:/i.test(b.mount)) - Number(/^D:/i.test(a.mount))), [volumes]);
  return (
    <PanelFrame
      title={t("system.storage.title")}
      icon={<HardDrive {...ICON} />}
      actions={<StatusStrip freshness={query.data?.freshness} source={query.data?.sources[0]?.system} />}
      state={state}
      skeletonRows={3}
    >
      <ul className="mc-list sy-volumes">
        {sorted.map((volume) => (
          <StorageRow key={volume.id} volume={volume} />
        ))}
      </ul>
    </PanelFrame>
  );
}

/* ── Event stream (§12.6) ─────────────────────────────────────────────── */

const STREAM_TONE: Record<RealtimeStatus["state"], Tone> = { online: "green", degraded: "amber", polling: "amber", connecting: "blue", offline: "red" };

export function EventStreamPanel() {
  const { t, locale } = useT();
  const status = useRealtimeStatus();
  const formatters = useFormatters();
  const lastEvent = status.lastEventAt === null ? null : new Date(status.lastEventAt).toISOString();
  const streamState = t(`stream.${status.state}` as MessageKey);
  return (
    <PanelFrame title={t("system.stream.title")} icon={<Waypoints {...ICON} />} state={{ kind: "ready" }}>
      <div className="mc-stack">
        <div className="mc-row">
          <StatusChip tone={STREAM_TONE[status.state]} pulse={status.state === "online"}>
            {t("system.stream.state", { state: streamState })}
          </StatusChip>
        </div>
        <dl className="mc-kvlist mc-kvlist--single">
          <KeyValue label={t("system.stream.roundtrip")} mono reason={t("system.stream.noRoundtrip")}>
            {status.roundtripMs === null ? null : formatMs(status.roundtripMs, locale)}
          </KeyValue>
          <KeyValue label={t("system.stream.lastEvent")} reason={t("system.stream.noEvent")}>
            {lastEvent ? formatters.relative(lastEvent) : null}
          </KeyValue>
          <KeyValue label={t("system.stream.sequence")} mono>
            {status.sequence === null ? null : formatters.number(status.sequence)}
          </KeyValue>
        </dl>
        {status.state === "offline" || status.state === "polling" ? (
          <p className="mc-note mc-note--muted">{t(status.state === "offline" ? "system.stream.offlineHint" : "system.stream.pollingHint")}</p>
        ) : null}
      </div>
    </PanelFrame>
  );
}

/* ── Installation (DASH-19.04) ────────────────────────────────────────── */

export function InstallationPanel() {
  const { t } = useT();
  const formatters = useFormatters();
  const query = useSystemInstallation();
  const data = query.data?.data;
  const state = useQueryPanelState(query, { module: "system", freshness: query.data?.freshness });
  const host = data ? (data.controlApi.host.includes(":") ? `[${data.controlApi.host}]` : data.controlApi.host) : "";
  return (
    <PanelFrame
      title={t("system.installation.title")}
      icon={<Fingerprint {...ICON} />}
      state={state}
      skeletonRows={3}
    >
      {data ? (
        <div className="mc-stack">
          <dl className="mc-kvlist mc-kvlist--single" data-testid="installation-runtime">
            <KeyValue label={t("system.installation.id")} mono>
              {data.installationId}
            </KeyValue>
            <KeyValue label={t("system.installation.commit")} mono reason={t("system.installation.noCommit")}>
              {data.dashboard.commit?.slice(0, 12) ?? null}
            </KeyValue>
            <KeyValue label={t("system.installation.installedAt")} reason={t("system.installation.noCommit")}>
              {data.dashboard.installedAt ? formatters.dateTime(data.dashboard.installedAt) : null}
            </KeyValue>
            <KeyValue label={t("system.installation.port")} mono>
              {`${host}:${data.controlApi.port} · PID ${data.controlApi.pid}`}
            </KeyValue>
            <KeyValue label={t("system.installation.startedAt")}>
              {formatters.dateTime(data.controlApi.startedAt)}
            </KeyValue>
            <KeyValue label={t("system.installation.contract")} mono>
              {data.controlApi.contractVersion}
            </KeyValue>
          </dl>
          <p className="mc-note mc-note--muted">{t("system.installation.hint")}</p>
        </div>
      ) : null}
    </PanelFrame>
  );
}

/* ── Services (§40.2) ─────────────────────────────────────────────────── */

const SERVICE_ICON: Record<Service["kind"], ReactNode> = {
  hermes: <Sparkles {...ICON} />,
  llm: <Sparkles {...ICON} />,
  voice: <Activity {...ICON} />,
  wsl: <Server {...ICON} />,
  api: <ShieldCheck {...ICON} />,
  stream: <Waypoints {...ICON} />,
  adapter: <PlugZap {...ICON} />,
  worker: <Cpu {...ICON} />,
  other: <Server {...ICON} />,
};

function ServiceRow({ service, canCheck }: { service: Service; canCheck: boolean }) {
  const { t, locale } = useT();
  const { toast } = useToast();
  const formatters = useFormatters();
  const healthLabels = useHealthLabels();
  const check = useServiceHealthcheck();
  const run = (): void =>
    check.mutate(
      { id: service.id },
      {
        onSuccess: (result) =>
          toast({
            title: t("system.services.checked", { name: service.name }),
            description: result.data.message,
            tone: result.data.status === "online" ? "green" : "amber",
          }),
      },
    );
  return (
    <li className="sy-service">
      <IconTile icon={SERVICE_ICON[service.kind]} tone={toneFromHealth(service.status)} size="sm" />
      <div className="sy-service__text">
        <strong>{service.name}</strong>
        <span className="mc-muted">
          {service.detail ? `${service.detail} · ` : ""}
          {t("system.services.lastCheck", { time: formatters.relative(service.lastCheckAt) })}
        </span>
      </div>
      <span className="mc-mono sy-service__latency" title={service.latencyMs === null ? t("system.hardware.noSource") : undefined}>
        {formatMs(service.latencyMs, locale)}
      </span>
      <HealthBadge state={healthStateFromWire(service.status)} labels={healthLabels} />
      <Button
        size="sm"
        variant="ghost"
        icon={<RefreshCw size={13} strokeWidth={1.5} />}
        loading={check.isPending}
        disabled={!canCheck}
        title={canCheck ? undefined : t("system.action.unavailable", { capability: "system.healthcheck" })}
        aria-label={t("system.services.check", { name: service.name })}
        onClick={run}
      >
        {t("system.action.healthcheck")}
      </Button>
    </li>
  );
}

export function ServicesPanel() {
  const { t } = useT();
  const query = useServices();
  const canCheck = useCapability("system", "healthcheck");
  const items = query.data?.items ?? [];
  const state = useQueryPanelState(query, {
    module: "system",
    empty: query.isSuccess && items.length === 0,
    emptyTitle: t("system.services.empty"),
    emptyIcon: <Server {...ICON} />,
    freshness: query.data?.freshness,
  });
  return (
    <PanelFrame
      title={t("system.services.title")}
      icon={<Server {...ICON} />}
      actions={<StatusStrip freshness={query.data?.freshness} source={query.data?.sources[0]?.system} />}
      state={state}
      skeletonRows={5}
    >
      <ul className="mc-list sy-services">
        {items.map((service) => (
          <ServiceRow key={service.id} service={service} canCheck={canCheck} />
        ))}
      </ul>
    </PanelFrame>
  );
}

/* ── Models ───────────────────────────────────────────────────────────── */

function providerStatus(status: HealthStatus, models: number): ProviderStatus {
  if (status === "offline") return "error";
  if (status === "degraded") return "degraded";
  if (status === "unknown" || status === "paused") return "not-linked";
  return models === 0 ? "no-models" : "connected";
}

/** Model names shown per provider; a provider with more models gets a "+N weitere" chip (full list as tooltip). */
const MAX_MODEL_NAMES = 12;

export function ModelsPanel() {
  const { t, locale } = useT();
  const query = useModelProviders();
  const items: ModelProvider[] = query.data?.items ?? [];
  const state = useQueryPanelState(query, {
    module: "system",
    empty: query.isSuccess && items.length === 0,
    emptyTitle: t("system.models.empty"),
    emptyIcon: <Sparkles {...ICON} />,
    freshness: query.data?.freshness,
  });
  const labels: Record<ProviderStatus, string> = {
    connected: t("system.models.connected"),
    "not-linked": t("system.models.notLinked"),
    degraded: t("health.degraded"),
    error: t("health.offline"),
    "no-models": t("system.models.noModels"),
  };
  return (
    <PanelFrame
      title={t("system.models.title")}
      icon={<Sparkles {...ICON} />}
      state={state}
      skeletonRows={3}
    >
      <div className="mc-strip-row">
        <StatusStrip freshness={query.data?.freshness} source={query.data?.sources[0]?.system} />
      </div>
      <div className="sy-providers sy-providers--stack">
        {items.map((provider) => {
          const status = providerStatus(provider.status, provider.models.length);
          const shown = provider.models.slice(0, MAX_MODEL_NAMES);
          const hidden = provider.models.slice(MAX_MODEL_NAMES);
          return (
            <div key={provider.id} className="sy-provider">
              <ProviderCard
                name={provider.name}
                icon={<Sparkles size={16} strokeWidth={1.5} />}
                status={status}
                statusLabel={labels[status]}
                detail={[provider.providerKind === "local" ? t("system.models.local") : t("system.models.cloud"), provider.latencyMs === null ? null : formatMs(provider.latencyMs, locale), t("system.models.count", { count: provider.models.length })]
                  .filter(Boolean)
                  .join(" · ")}
              />
              {provider.models.length > 0 ? (
                <ul className="sy-models" aria-label={`${t("system.models.names")}: ${provider.name}`}>
                  {shown.map((model) => (
                    <li key={model}>
                      <TagPill tone="muted" className="mc-mono">
                        {model}
                      </TagPill>
                    </li>
                  ))}
                  {hidden.length > 0 ? (
                    <li>
                      <TagPill tone="muted" title={hidden.join(", ")}>
                        {t("system.models.more", { count: hidden.length })}
                      </TagPill>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="mc-muted sy-models__none">{t("system.models.noNames")}</p>
              )}
            </div>
          );
        })}
      </div>
    </PanelFrame>
  );
}

/* ── Adapter matrix (§40.3) ───────────────────────────────────────────── */

function adapterCapabilitiesLabel(adapter: AdapterInfo): string {
  const caps = adapter.manifest.capabilities;
  return caps.length === 0 ? MISSING : caps.join(", ");
}

function AdapterSummary({ adapters }: { adapters: AdapterInfo[] }) {
  const { t } = useT();
  const count = (status: HealthStatus): number => adapters.filter((a) => a.health.status === status).length;
  return (
    <div className="mc-row" aria-label={t("system.adapters.summary")}>
      <StatusChip tone="muted" dot={false}>
        {t("system.adapters.total", { count: adapters.length })}
      </StatusChip>
      <StatusChip tone="green">{t("system.adapters.online", { count: count("online") })}</StatusChip>
      <StatusChip tone="amber">{t("system.adapters.degraded", { count: count("degraded") })}</StatusChip>
      <StatusChip tone="red">{t("system.adapters.offline", { count: count("offline") })}</StatusChip>
    </div>
  );
}

interface AdapterDrawerProps {
  adapter: AdapterInfo | undefined;
  onClose: () => void;
}

function ActionButton({
  label,
  icon,
  capability,
  granted,
  onClick,
  loading,
  variant = "ghost",
}: {
  label: string;
  icon: ReactNode;
  capability: string;
  granted: boolean;
  onClick: () => void;
  loading?: boolean;
  variant?: "ghost" | "danger";
}) {
  const { t } = useT();
  return (
    <div className="sy-action">
      <Button variant={variant} size="sm" icon={icon} disabled={!granted} loading={loading} onClick={onClick}>
        {label}
      </Button>
      {granted ? null : <span className="mc-muted sy-action__reason">{t("system.action.unavailable", { capability })}</span>}
    </div>
  );
}

function AdapterDrawer({ adapter, onClose }: AdapterDrawerProps) {
  const { t, locale } = useT();
  const { toast } = useToast();
  const formatters = useFormatters();
  const healthLabels = useHealthLabels();
  const restart = useRestartAdapter();
  const healthcheck = useAdapterHealthCheck();
  const reconnect = useAdapterReconnect();
  const canCheck = useCapability("system", "healthcheck");
  const canRestart = useCapability("system", "restartAdapter");
  const canLogs = useCapability("system", "openLogs");
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const id = adapter?.manifest.id;
  const name = adapter?.manifest.name ?? "";
  const doHealthcheck = (): void => {
    if (!id) return;
    healthcheck.mutate(
      { id },
      {
        onSuccess: (result) =>
          toast({
            title: t("system.adapters.checked", { name }),
            description: `${t(`health.${result.data.status}` as MessageKey)} · ${formatMs(result.data.latencyMs, locale)}`,
            tone: result.data.status === "online" ? "green" : "amber",
          }),
      },
    );
  };
  const doReconnect = (): void => {
    if (!id) return;
    reconnect.mutate(
      { id },
      {
        onSuccess: (result) =>
          toast({ title: t("system.adapters.reconnected", { name }), description: result.data.message, tone: result.data.success ? "green" : "red" }),
      },
    );
  };
  const doRestart = (): void => {
    if (!id) return;
    restart.mutate(
      { id },
      {
        onSuccess: (result) => {
          setConfirmRestart(false);
          toast({ title: t("system.restart.done", { name }), description: result.message, tone: "green" });
        },
        onError: () => setConfirmRestart(false),
      },
    );
  };

  return (
    <>
      <Drawer
        open={Boolean(adapter)}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={name || t("system.adapters.title")}
        subtitle={id}
        icon={<PlugZap size={18} strokeWidth={1.5} />}
        width={480}
      >
        {adapter ? (
          <div className="mc-stack">
            <div className="mc-row">
              <HealthBadge state={healthStateFromWire(adapter.health.status)} labels={healthLabels} />
              <TagPill tone={adapter.mode === "mock" ? "violet" : "green"}>{adapter.mode === "mock" ? t("system.adapters.mock") : t("system.adapters.live")}</TagPill>
              {adapter.enabled ? null : <TagPill tone="muted">{t("system.adapters.disabled")}</TagPill>}
            </div>
            <dl className="mc-kvlist">
              <KeyValue label={t("system.adapters.col.version")} mono>
                {adapter.manifest.adapterVersion}
              </KeyValue>
              <KeyValue label={t("system.adapters.remoteVersion")} mono reason={t("system.adapters.noRemoteVersion")}>
                {adapter.health.remoteVersion ?? null}
              </KeyValue>
              <KeyValue label={t("system.adapters.category")}>{adapter.manifest.category}</KeyValue>
              <KeyValue label={t("system.adapters.provider")} mono>
                {adapter.provider}
              </KeyValue>
              <KeyValue label={t("system.adapters.lifecycle")} mono>
                {adapter.health.lifecycle}
              </KeyValue>
              <KeyValue label={t("system.adapters.circuit")} mono>
                {adapter.health.circuit}
              </KeyValue>
              <KeyValue label={t("system.adapters.failures")} mono>
                {String(adapter.health.consecutiveFailures)}
              </KeyValue>
              <KeyValue label={t("system.adapters.col.latency")} mono reason={t("system.hardware.noSource")}>
                {adapter.health.latencyMs === null ? null : formatMs(adapter.health.latencyMs, locale)}
              </KeyValue>
              <KeyValue label={t("system.adapters.checkedAt")}>{formatters.dateTime(adapter.health.checkedAt)}</KeyValue>
              <KeyValue label={t("system.adapters.col.lastSuccess")} reason={t("system.adapters.noSuccess")}>
                {adapter.health.lastSuccessAt ? formatters.dateTime(adapter.health.lastSuccessAt) : null}
              </KeyValue>
              <KeyValue label={t("system.adapters.contract")} mono>
                {`${adapter.manifest.contractVersion} / API ${adapter.manifest.apiVersion}`}
              </KeyValue>
            </dl>
            {adapter.health.lastError ? (
              <div className="mc-box mc-box--amber" role="note">
                <h3 className="mc-subtitle">{t("system.adapters.lastError")}</h3>
                <p className="mc-note">
                  <span className="mc-mono">{adapter.health.lastError.code}</span> — {adapter.health.lastError.message}
                </p>
              </div>
            ) : null}
            <section aria-label={t("system.adapters.col.capabilities")}>
              <h3 className="mc-subtitle">{t("system.adapters.col.capabilities")}</h3>
              <div className="mc-row">
                {adapter.manifest.capabilities.length === 0 ? (
                  <span className="mc-null">{MISSING}</span>
                ) : (
                  adapter.manifest.capabilities.map((capability) => (
                    <TagPill key={capability} tone="cyan">
                      {capability}
                    </TagPill>
                  ))
                )}
              </div>
            </section>
            <section aria-label={t("system.actions.title")}>
              <h3 className="mc-subtitle">{t("system.actions.title")}</h3>
              <div className="sy-actions">
                <ActionButton
                  label={t("system.action.healthcheck")}
                  icon={<Activity size={14} strokeWidth={1.5} />}
                  capability="system.healthcheck"
                  granted={canCheck}
                  loading={healthcheck.isPending}
                  onClick={doHealthcheck}
                />
                <ActionButton
                  label={t("system.action.reconnect")}
                  icon={<RefreshCw size={14} strokeWidth={1.5} />}
                  capability="system.healthcheck"
                  granted={canCheck}
                  loading={reconnect.isPending}
                  onClick={doReconnect}
                />
                <ActionButton
                  label={t("system.action.restart")}
                  icon={<RotateCcw size={14} strokeWidth={1.5} />}
                  capability="system.restartAdapter"
                  granted={canRestart}
                  variant="danger"
                  onClick={() => setConfirmRestart(true)}
                />
                <ActionButton
                  label={t("system.action.logs")}
                  icon={<FileText size={14} strokeWidth={1.5} />}
                  capability="system.openLogs"
                  granted={canLogs}
                  onClick={() => setShowLogs(true)}
                />
              </div>
              <p className="mc-note mc-note--muted sy-actions__hint">{t("system.actions.hint")}</p>
            </section>
          </div>
        ) : null}
      </Drawer>
      <ConfirmDialog
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        title={t("system.restart.title", { name })}
        description={t("system.restart.description", { name })}
        details={[t("system.restart.impact1"), t("system.restart.impact2"), t("system.restart.impact3")]}
        confirmLabel={t("system.restart.confirm")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        loading={restart.isPending}
        onConfirm={doRestart}
      />
      {id && showLogs ? <AdapterLogsDialog adapterId={id} name={name} open onOpenChange={setShowLogs} /> : null}
    </>
  );
}

function AdapterMatrix() {
  const { t, locale } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const compact = useMediaQuery("(max-width: 900px)");
  const formatters = useFormatters();
  const healthLabels = useHealthLabels();
  const query = useAdapters();
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const selectedId = params.get("adapter");
  const selected = items.find((adapter) => adapter.manifest.id === selectedId);
  const state = useQueryPanelState(query, {
    module: "system",
    gate: false,
    empty: query.isSuccess && items.length === 0,
    emptyTitle: t("system.adapters.empty"),
    emptyDescription: t("system.adapters.emptyDescription"),
    emptyIcon: <PlugZap {...ICON} />,
    freshness: query.data?.freshness,
  });

  const select = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set("adapter", id);
      else next.delete("adapter");
      const qs = next.toString();
      router.replace(qs ? `/system?${qs}` : "/system", { scroll: false });
    },
    [params, router],
  );

  const columns = useMemo<DataTableColumn<AdapterInfo>[]>(
    () => [
      {
        id: "adapter",
        header: t("system.adapters.col.adapter"),
        width: "minmax(180px, 1.5fr)",
        sortable: true,
        sortValue: (a) => a.manifest.name,
        cell: (a) => (
          <span className="sy-adapter">
            <strong>{a.manifest.name}</strong>
            <span className="mc-muted mc-mono">{a.manifest.id}</span>
          </span>
        ),
      },
      {
        id: "status",
        header: t("system.adapters.col.status"),
        width: "150px",
        sortable: true,
        sortValue: (a) => a.health.status,
        cell: (a) => <HealthBadge state={healthStateFromWire(a.health.status)} labels={healthLabels} />,
      },
      {
        id: "latency",
        header: t("system.adapters.col.latency"),
        width: "100px",
        align: "right",
        mono: true,
        sortable: true,
        sortValue: (a) => a.health.latencyMs,
        cell: (a) => formatMs(a.health.latencyMs, locale),
      },
      {
        id: "capabilities",
        header: t("system.adapters.col.capabilities"),
        width: "minmax(160px, 2fr)",
        cell: (a) => (
          <span className="sy-caps" title={adapterCapabilitiesLabel(a)}>
            <TagPill tone="cyan">{a.manifest.capabilities.length}</TagPill>
            <span className="sy-caps__text">{adapterCapabilitiesLabel(a)}</span>
          </span>
        ),
      },
      {
        id: "version",
        header: t("system.adapters.col.version"),
        width: "90px",
        mono: true,
        sortable: true,
        sortValue: (a) => a.manifest.adapterVersion,
        cell: (a) => a.manifest.adapterVersion,
      },
      {
        id: "lastSuccess",
        header: t("system.adapters.col.lastSuccess"),
        width: "140px",
        sortable: true,
        sortValue: (a) => a.health.lastSuccessAt,
        cell: (a) => (a.health.lastSuccessAt ? formatters.relative(a.health.lastSuccessAt) : <span className="mc-null">{MISSING}</span>),
      },
    ],
    [t, locale, healthLabels, formatters],
  );

  return (
    <>
      <PanelFrame
        title={t("system.adapters.title")}
        subtitle={t("system.adapters.subtitle")}
        icon={<PlugZap {...ICON} />}
        actions={<StatusStrip freshness={query.data?.freshness} source={query.data?.sources[0]?.system} />}
        state={state}
        skeletonRows={6}
      >
        <div className="mc-stack">
          <AdapterSummary adapters={items} />
          <DataTable<AdapterInfo>
            label={t("system.adapters.title")}
            columns={columns}
            rows={items}
            getRowId={(a) => a.manifest.id}
            height={compact ? 520 : Math.min(560, 62 + items.length * 44)}
            rowHeight={44}
            selectedId={selected?.manifest.id}
            onRowActivate={(a) => select(a.manifest.id)}
            cardBreakpoint={760}
            defaultSort={{ columnId: "adapter", direction: "asc" }}
            empty={<EmptyState compact title={t("system.adapters.empty")} />}
            countLabel={(shown, total) => t("system.adapters.count", { shown, total })}
          />
          <p className="mc-note mc-note--muted">{t("system.adapters.hint")}</p>
        </div>
      </PanelFrame>
      <AdapterDrawer adapter={selected} onClose={() => select(null)} />
    </>
  );
}

export function SystemPage() {
  return (
    <div className="mc-page sy-page">
      <div className="mc-grid sy-top">
        <HardwarePanel />
        <div className="mc-stack">
          <StoragePanel />
          <EventStreamPanel />
          <InstallationPanel />
        </div>
      </div>
      <div className="mc-grid sy-mid">
        <ServicesPanel />
        <ModelsPanel />
      </div>
      <Suspense fallback={null}>
        <AdapterMatrix />
      </Suspense>
    </div>
  );
}
