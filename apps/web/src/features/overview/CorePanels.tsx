"use client";

import type { HealthStatus, Overview } from "@jarvis/sdk";
import { ActivityFeed, ActivityRow, HudPanel, PanelLink, StatusChip, type ActivityItem, type Tone } from "@jarvis/ui";
import { Bot, Brain, CheckCircle2, Database, Mic, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { OrbSlot } from "@/features/orb/OrbSlot";
import { useOrbSnapshot } from "@/features/orb/useOrbSnapshot";
import { attentionVisual, severityFromWire, toneFromHealth } from "@/features/shared/presentation";
import { formatClockTime } from "@/features/shared/time";
import { orbStatusKey } from "@/features/voice/useVoiceUi";
import { useT, type MessageKey } from "@/i18n";
import { useAppSettings } from "@/lib/settings";
import { useOverviewPanel } from "./useOverviewPanel";

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

function coreRows(overview: Overview, t: (key: MessageKey, vars?: Record<string, string | number>) => string, locale: string): CoreRow[] {
  const { jarvis, voice, memoryInsights, activeAgents, models, systemSummary } = overview;
  const statusWord = (status: HealthStatus): string => t(`health.${status}` as MessageKey);
  const connectedModels = models.filter((m) => m.status === "online").length;
  const worst: HealthStatus = systemSummary.services.some((s) => s.status === "offline")
    ? "offline"
    : systemSummary.services.some((s) => s.status === "degraded") || jarvis.adapterSummary.degraded > 0 || jarvis.adapterSummary.offline > 0
      ? "degraded"
      : "online";
  const working = activeAgents.filter((a) => a.status === "working" || a.status === "starting").length;
  return [
    { id: "core", icon: <Brain {...ICON} />, tone: toneFromHealth(jarvis.status), title: t("core.aiCore"), meta: statusWord(jarvis.status), route: "/system" },
    {
      id: "memory",
      icon: <Database {...ICON} />,
      tone: memoryInsights ? "blue" : "muted",
      title: t("core.memory"),
      meta: memoryInsights ? t("core.memory.stored", { count: formatCount(memoryInsights.total, locale) }) : t("core.notConnected"),
      route: "/memory",
    },
    {
      id: "voice",
      icon: <Mic {...ICON} />,
      tone: voice ? (voice.mode === "error" ? "red" : "green") : "muted",
      title: t("core.voice"),
      meta: voice ? t(`core.voice.${voice.mode}` as MessageKey) : t("core.notConnected"),
      route: "/voice",
    },
    {
      id: "agents",
      icon: <Bot {...ICON} />,
      tone: "violet",
      title: t("core.agents"),
      meta: t("core.agents.active", { count: working }),
      route: "/agents",
    },
    {
      id: "models",
      icon: <Sparkles {...ICON} />,
      tone: connectedModels > 0 ? "amber" : "muted",
      title: t("core.models"),
      meta: t("core.models.connected", { count: connectedModels }),
      route: "/system",
    },
    {
      id: "system",
      icon: <ShieldCheck {...ICON} />,
      tone: toneFromHealth(worst),
      title: t("core.system"),
      meta: worst === "online" ? t("core.system.optimal") : statusWord(worst),
      route: "/system",
    },
  ];
}

export function CoreOverviewPanel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const { t, locale } = useT();
  const router = useRouter();
  const { overview, resolve } = useOverviewPanel(["core", "voice", "memory", "agents", "models", "system"]);
  const state = resolve();
  const rows = overview ? coreRows(overview, t, locale) : [];
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

export function OrbPanel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const { t, locale } = useT();
  const { timeZone, hour12 } = useAppSettings();
  const { overview } = useOverviewPanel([]);
  const orb = useOrbSnapshot().snapshot ?? overview?.orb;
  const status = orb?.status;
  const mode = status?.mode;
  const agent = overview?.activeAgents.find((a) => a.id === (overview.currentActivity?.agentId ?? status?.currentAgentId));
  const activity = overview?.currentActivity?.text ?? status?.activityText;
  const dataMode = overview?.jarvis.dataMode;
  const version = overview?.jarvis.version;
  const progress = status?.progressMode === "determinate" && typeof status.progress === "number" ? Math.round(Math.min(1, Math.max(0, status.progress)) * 100) : null;
  const tone: Tone = mode === "error" ? "red" : mode === "offline" ? "muted" : mode === "waiting_approval" || mode === "warning" ? "amber" : "gold";

  return (
    <HudPanel className={className} style={style} tone="gold" glow cut="all" cutSize="lg" brackets={["tl", "tr", "bl", "br"]} padding="none" aria-label={t("overview.orb.label")}>
      <div className="ov-orb">
        <div className="ov-orb__stage">
          <OrbSlot />
        </div>
        <div className="ov-orb__brand">
          <span className="ov-orb__name">JARVIS</span>
          <span className="ov-orb__sub">AI CORE</span>
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
