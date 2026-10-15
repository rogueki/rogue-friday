"use client";

import type { AdapterInfo, HealthStatus, Overview } from "@friday/sdk";
import { ActivityFeed, ActivityRow, HudPanel, PanelLink, StatusChip, type ActivityItem, type Tone } from "@friday/ui";
import { Bot, Brain, CheckCircle2, Database, Mic, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { OrbSlot } from "@/features/orb/OrbSlot";
import { useOrbSnapshot } from "@/features/orb/useOrbSnapshot";
import { attentionVisual, severityFromWire, toneFromHealth } from "@/features/shared/presentation";
import { formatClockTime } from "@/features/shared/time";
import { orbStatusKey } from "@/features/voice/useVoiceUi";
import { useT, type MessageKey } from "@/i18n";
import { useAdapters } from "@/lib/api/domains/system";
import { useAppSettings } from "@/lib/settings";
import { adapterNotConfigured, isUnconfiguredEntry } from "@/features/shared/availability";
import { sectionStatus, useOverviewPanel } from "./useOverviewPanel";

const ICON = { size: 18, strokeWidth: 1.5 } as const;

function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-GB").format(value);
}

/* ── AI Core overview (left, compact) ─────────────────────────────────── */

interface CoreRow {
  id: string;
  icon: ReactNode;
  tone: Tone;
  title: string;
  meta: string;
  route: string;
}

type TileAvailability = "ok" | "degraded" | "offline" | "not-configured";

/** What the overview says about the adapter behind one tile: outage, nothing configured, degraded or fine (PLAN §9.3). */
function tileAvailability(overview: Overview, category: string, adapters: readonly AdapterInfo[] | undefined): TileAvailability {
  const status = sectionStatus(overview, [category], adapters);
  const entry = status.offline;
  if (entry) {
    const adapter = adapters?.find((candidate) => candidate.manifest.id === entry.adapterId);
    return isUnconfiguredEntry(entry) || (adapter !== undefined && adapterNotConfigured(adapter)) ? "not-configured" : "offline";
  }
  return status.degraded ? "degraded" : "ok";
}

/** Health of the host itself: metrics pressure, not the services (those belong to the voice/agents/models tiles). */
function systemHealth(overview: Overview, adapters: readonly AdapterInfo[] | undefined): HealthStatus {
  const availability = tileAvailability(overview, "system", adapters);
  if (availability === "offline") return "offline";
  if (availability === "degraded") return "degraded";
  const { cpuPercent, ramPercent, storageUsedPercent, gpuPercent, vramPercent } = overview.systemSummary;
  const readings = [cpuPercent, ramPercent, storageUsedPercent, gpuPercent, vramPercent].filter((value): value is number => typeof value === "number");
  if (readings.length === 0) return "unknown";
  return readings.some((value) => value >= PRESSURE_PERCENT) ? "degraded" : "online";
}

const PRESSURE_PERCENT = 90;

function coreRows(overview: Overview, adapters: readonly AdapterInfo[] | undefined, t: (key: MessageKey, vars?: Record<string, string | number>) => string, locale: string): CoreRow[] {
  const { friday, voice, memoryInsights, activeAgents, models } = overview;
  const statusWord = (status: HealthStatus): string => t(`health.${status}` as MessageKey);
  const connectedModels = models.filter((m) => m.status === "online").length;
  const working = activeAgents.filter((a) => a.status === "working" || a.status === "starting").length;
  /** Row text and tone for a tile whose adapter is down; `null` when the adapter is fine. */
  const unavailable = (category: string, dataMissing = false): { meta: string; tone: Tone } | null => {
    const availability = tileAvailability(overview, category, adapters);
    // A tile whose own data is absent while its adapter is registered is an outage, even when the server flags the
    // section "degraded" (health lags behind a failing call, or a stored overview was taken in that window). It must
    // never fall through to "Nicht verbunden", which means "no adapter configured".
    if (availability === "offline" || (dataMissing && availability === "degraded")) return { meta: t("core.offline"), tone: toneFromHealth("offline") };
    if (availability === "not-configured") return { meta: t("core.notConnected"), tone: "muted" };
    return null;
  };
  const memoryDown = memoryInsights ? null : unavailable("memory", true);
  const voiceDown = voice ? null : unavailable("voice", true);
  const agentsDown = unavailable("agents");
  const systemDown = unavailable("system");
  const host = systemHealth(overview, adapters);
  return [
    { id: "core", icon: <Brain {...ICON} />, tone: toneFromHealth(friday.status), title: t("core.aiCore"), meta: statusWord(friday.status), route: "/system" },
    {
      id: "memory",
      icon: <Database {...ICON} />,
      tone: memoryInsights ? "blue" : (memoryDown?.tone ?? "muted"),
      title: t("core.memory"),
      meta: memoryInsights ? t("core.memory.stored", { count: formatCount(memoryInsights.total, locale) }) : (memoryDown?.meta ?? t("core.notConnected")),
      route: "/memory",
    },
    {
      id: "voice",
      icon: <Mic {...ICON} />,
      tone: voice ? (voice.mode === "error" ? "red" : "green") : (voiceDown?.tone ?? "muted"),
      title: t("core.voice"),
      meta: voice ? t(`core.voice.${voice.mode}` as MessageKey) : (voiceDown?.meta ?? t("core.notConnected")),
      route: "/voice",
    },
    {
      id: "agents",
      icon: <Bot {...ICON} />,
      tone: agentsDown?.tone ?? "violet",
      title: t("core.agents"),
      meta: agentsDown?.meta ?? t("core.agents.active", { count: working }),
      route: "/agents",
    },
    {
      id: "models",
      icon: <Sparkles {...ICON} />,
      tone: systemDown?.tone ?? (connectedModels > 0 ? "amber" : "muted"),
      title: t("core.models"),
      meta: systemDown?.meta ?? t("core.models.connected", { count: connectedModels }),
      route: "/system",
    },
    {
      id: "system",
      icon: <ShieldCheck {...ICON} />,
      tone: systemDown?.tone ?? toneFromHealth(host),
      title: t("core.system"),
      meta: systemDown?.meta ?? (host === "online" ? t("core.system.optimal") : host === "degraded" ? t("core.system.degraded") : statusWord(host)),
      route: "/system",
    },
  ];
}

export function CoreOverviewPanel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const { t, locale } = useT();
  const router = useRouter();
  // No sections: one failing adapter must not replace the whole tile list, each tile derives its own outage / "not connected".
  const { overview, resolve } = useOverviewPanel([]);
  const state = resolve();
  const adapters = useAdapters().data?.items;
  const rows = overview ? coreRows(overview, adapters, t, locale) : [];
  return (
    <PanelFrame className={className} style={style} title={t("overview.core.title")} state={state} scroll skeletonRows={6}>
      <div className="ov-stack ov-stack--fill">
        {rows.map((row) => (
          <ActivityRow key={row.id} icon={row.icon} tone={row.tone} title={row.title} meta={row.meta} onClick={() => router.push(row.route)} />
        ))}
      </div>
    </PanelFrame>
  );
}

/* ── AI Core / orb panel (center) ─────────────────────────────────────── */

/** The globe fills the stage like in the reference (PLAN §27.3); see `OrbSlotProps.sizeBoost`. */
const ORB_PANEL_SIZE_BOOST = 1.25;

export function OrbPanel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const { t, locale, assistantName } = useT();
  const { timeZone, hour12 } = useAppSettings();
  const { overview } = useOverviewPanel([]);
  const [renderer, setRenderer] = useState<"3d" | "2d">("3d");
  const orb = useOrbSnapshot().snapshot ?? overview?.orb;
  const status = orb?.status;
  const mode = status?.mode;
  const agent = overview?.activeAgents.find((a) => a.id === (overview.currentActivity?.agentId ?? status?.currentAgentId));
  const activity = overview?.currentActivity?.text ?? status?.activityText;
  const dataMode = overview?.friday.dataMode;
  const version = overview?.friday.version;
  const progress = status?.progressMode === "determinate" && typeof status.progress === "number" ? Math.round(Math.min(1, Math.max(0, status.progress)) * 100) : null;
  const tone: Tone = mode === "error" ? "red" : mode === "offline" ? "muted" : mode === "waiting_approval" || mode === "warning" ? "amber" : "gold";

  return (
    <HudPanel className={className} style={style} tone="gold" glow cut="all" cutSize="lg" brackets={["tl", "tr", "bl", "br"]} padding="none" aria-label={t("overview.orb.label")}>
      <div className="ov-orb">
        <div className="ov-orb__stage">
          <OrbSlot sizeBoost={ORB_PANEL_SIZE_BOOST} onRendererChange={setRenderer} />
        </div>
        <div className="ov-orb__brand">
          <span className="ov-orb__name">{assistantName}</span>
          <span className="ov-orb__sub">{t("brand.aiCore")}</span>
          <span className="ov-orb__ver">
            {[version ? `v${version}` : null, dataMode ? t(`dataMode.${dataMode}` as MessageKey) : null].filter(Boolean).join(" · ")}
          </span>
        </div>
        <div className="ov-orb__status" role="status">
          <StatusChip tone={tone} pulse={mode === "listening" || mode === "speaking" || mode === "working"}>
            {t(orbStatusKey(mode))}
          </StatusChip>
          <span className="ov-orb__activity">
            {agent
              ? t("overview.orb.agent", { agent: agent.name, activity: activity ?? agent.role })
              : (activity ?? t("overview.orb.noAgent"))}
          </span>
          {progress !== null ? (
            <span className="ov-orb__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t("overview.orb.progress")}>
              <span style={{ width: `${progress}%` }} />
              <span className="ov-orb__progress-text">{progress} %</span>
            </span>
          ) : null}
        </div>
        {renderer === "2d" ? (
          <span className="ov-orb__notice" role="note" title={t("overview.orb.fallback2dHint")}>
            {t("overview.orb.fallback2d")}
          </span>
        ) : null}
        {overview ? (
          <span className="ov-orb__updated">{t("overview.orb.updated", { time: formatClockTime(overview.lastUpdatedAt, { locale, timeZone, hour12 }) })}</span>
        ) : null}
      </div>
    </HudPanel>
  );
}

/* ── Attention zone (right) ───────────────────────────────────────────── */

const SEVERITY_RANK = { critical: 0, error: 1, warning: 2, info: 3 } as const;

export function AttentionPanel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const { t, locale } = useT();
  const router = useRouter();
  const { timeZone, hour12 } = useAppSettings();
  const { overview, resolve } = useOverviewPanel(["attention", "alerts", "approvals", "mail", "tasks"]);

  const items = useMemo<ActivityItem[]>(() => {
    const sorted = (overview?.attention ?? []).slice().sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.occurredAt.localeCompare(a.occurredAt));
    return sorted.map((item) => {
      const visual = attentionVisual(item);
      return {
        id: item.id,
        icon: visual.icon,
        tone: visual.tone,
        severity: severityFromWire(item.severity),
        title: item.title,
        meta: `${t(`attention.kind.${item.kind}` as MessageKey)}${item.summary ? ` · ${item.summary}` : ""}`,
        time: formatClockTime(item.occurredAt, { locale, timeZone, hour12 }),
        onClick: () => router.push(visual.route),
      };
    });
  }, [overview?.attention, t, locale, timeZone, hour12, router]);

  const state = resolve({
    empty: items.length === 0,
    emptyTitle: t("overview.attention.empty"),
    emptyDescription: t("overview.attention.emptyHint"),
    emptyIcon: <CheckCircle2 size={22} strokeWidth={1.5} />,
  });

  return (
    <PanelFrame
      className={className}
      style={style}
      title={t("overview.attention.title")}
      live={state.kind === "ready" ? true : undefined}
      padding="sm"
      state={state}
      footer={<PanelLink onClick={() => router.push("/alerts")}>{t("overview.attention.all")}</PanelLink>}
    >
      <ActivityFeed items={items} label={t("overview.attention.label")} rowHeight={48} gap={5} />
    </PanelFrame>
  );
}
