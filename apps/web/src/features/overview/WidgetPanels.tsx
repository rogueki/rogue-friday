"use client";

import type { CalendarEvent, ModelProvider, Overview, Task } from "@friday/sdk";
import {
  ActivityRow,
  AgentCard,
  CircularMetric,
  ConstellationGraph,
  PanelLink,
  ProviderCard,
  StatusChip,
  Timeline,
  useMediaQuery,
  useNow,
  type GraphNode,
  type ProviderStatus,
  type Tone,
  type TimelineItem,
} from "@friday/ui";
import { useQuery } from "@tanstack/react-query";
import { Activity, Bot, CalendarDays, ChevronDown, Cpu, FileText, Mail, Mic, Pause, Plus, Server, Sparkles, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { useCreateTaskDialog } from "@/features/palette/CreateTaskDialog";
import { useRunCommand } from "@/features/palette/commandRunner";
import { agentCardStatus, agentIconFor, agentTone, toneFromHealth } from "@/features/shared/presentation";
import { formatClockTime, formatDuration, formatRelative, isSameDay } from "@/features/shared/time";
import { useFitCount } from "@/features/shared/useFitCount";
import { useT, type MessageKey } from "@/i18n";
import { memoryQueries } from "@/lib/api/domains/memory";
import { useSystemMetrics } from "@/lib/api/domains/system";
import { capabilityPathState, useCapabilities } from "@/lib/capabilities";
import { useAppSettings } from "@/lib/settings";
import { useOverviewPanel } from "./useOverviewPanel";

interface PanelProps {
  className?: string;
  style?: CSSProperties;
}

const ICON = { size: 18, strokeWidth: 1.5 } as const;

/* ── Active agents ────────────────────────────────────────────────────── */

export function ActiveAgentsPanel({ className, style }: PanelProps) {
  const { t } = useT();
  const router = useRouter();
  const { overview, resolve } = useOverviewPanel(["agents"]);
  const agents = useMemo(() => overview?.activeAgents ?? [], [overview?.activeAgents]);
  const taskTitle = useMemo(() => new Map((overview?.runningTasks ?? []).map((task) => [task.id, task.title])), [overview?.runningTasks]);
  const sorted = useMemo(() => {
    const rank = (status: string): number => (status === "working" || status === "starting" ? 0 : status === "waiting" ? 1 : status === "error" ? 2 : 3);
    return agents.slice().sort((a, b) => rank(a.status) - rank(b.status)).slice(0, 6);
  }, [agents]);
  const state = resolve({ empty: agents.length === 0, emptyTitle: t("overview.agents.empty") });
  return (
    <PanelFrame
      className={className}
      style={style}
      title={t("overview.agents.title")}
      actions={<PanelLink onClick={() => router.push("/agents")}>{t("common.all")}</PanelLink>}
      state={state}
      skeletonRows={2}
    >
      <div className="ov-agents">
        {sorted.map((agent, index) => (
          <AgentCard
            key={agent.id}
            name={agent.name}
            icon={agentIconFor(agent.name, agent.role)}
            tone={agentTone(agent.accent, index)}
            status={agentCardStatus(agent.status)}
            statusLabel={t(`agent.status.${agent.status}` as MessageKey)}
            task={(agent.currentTaskId ? taskTitle.get(agent.currentTaskId) : undefined) ?? agent.role}
            seed={index + 2}
            onClick={() => router.push(`/agents?agent=${encodeURIComponent(agent.id)}`)}
          />
        ))}
      </div>
    </PanelFrame>
  );
}

/* ── Mission timeline ─────────────────────────────────────────────────── */

const MAX_TIMELINE_ITEMS = 8;
const MAX_SERVICE_CHIPS = 6;
const MAX_SERVICE_CHIPS_SHORT = 3;

export function buildTimeline(
  overview: Overview,
  now: Date,
  format: { locale: string; timeZone?: string; hour12?: boolean },
  labels: { done: string; blocked: string; due: string; minutes: string; hours: string },
): TimelineItem[] {
  const items: (TimelineItem & { at: number })[] = [];
  const same = (d: Date): boolean => isSameDay(d, now, format);

  for (const event of overview.nextEvents as CalendarEvent[]) {
    if (event.status === "cancelled") continue;
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (!same(start) && start.getTime() < now.getTime()) continue;
    const running = start.getTime() <= now.getTime() && now.getTime() < end.getTime();
    const done = end.getTime() <= now.getTime();
    const prefix = same(start) ? "" : `${new Intl.DateTimeFormat(format.locale, { weekday: "short", timeZone: format.timeZone }).format(start)} `;
    items.push({
      id: event.id,
      at: start.getTime(),
      time: `${prefix}${formatClockTime(event.start, format)}`,
      title: event.title,
      status: done ? "done" : running ? "now" : "upcoming",
      progress: running ? Math.round(((now.getTime() - start.getTime()) / Math.max(1, end.getTime() - start.getTime())) * 100) : done ? 100 : 0,
      meta: done ? labels.done : running ? formatDuration(end.getTime() - now.getTime(), labels) : formatRelative(start, now, format.locale),
    });
  }

  for (const task of overview.runningTasks as Task[]) {
    const due = task.dueAt ?? task.estimatedCompletionAt;
    const blocked = task.blockers.length > 0;
    const determinate = task.progress.mode === "determinate" && task.progress.value !== null;
    items.push({
      id: task.id,
      at: due ? new Date(due).getTime() : now.getTime(),
      time: due ? formatClockTime(due, format) : "—",
      title: task.title,
      status: blocked ? "blocked" : "now",
      progress: determinate ? Math.round((task.progress.value ?? 0) * 100) : null,
      meta: blocked ? labels.blocked : due ? `${labels.due} ${formatRelative(new Date(due), now, format.locale)}` : undefined,
    });
  }

  return items
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_TIMELINE_ITEMS)
    .map(({ at: _at, ...item }) => item);
}

export function MissionTimelinePanel({ className, style }: PanelProps) {
  const { t, locale } = useT();
  const router = useRouter();
  const { timeZone, hour12 } = useAppSettings();
  const now = useNow(30_000);
  const { overview, resolve } = useOverviewPanel(["calendar", "tasks", "timeline"]);
  const items = useMemo(
    () =>
      overview
        ? buildTimeline(overview, now, { locale: locale === "de" ? "de-DE" : "en-GB", timeZone, hour12 }, {
            done: t("timeline.done"),
            blocked: t("timeline.blocked"),
            due: t("timeline.due"),
            minutes: t("time.minutes"),
            hours: t("time.hours"),
          })
        : [],
    [overview, now, locale, timeZone, hour12, t],
  );
  const state = resolve({ empty: items.length === 0, emptyTitle: t("overview.timeline.empty"), emptyIcon: <CalendarDays size={22} strokeWidth={1.5} /> });
  const taskIds = useMemo(() => new Set((overview?.runningTasks ?? []).map((task) => task.id)), [overview?.runningTasks]);
  const [fitRef, fitCount] = useFitCount<HTMLDivElement>(35, 0);
  return (
    <PanelFrame
      className={className}
      style={style}
      title={t("overview.timeline.title")}
      actions={
        <span className="ov-today">
          {t("overview.timeline.today")} <ChevronDown size={12} aria-hidden="true" />
        </span>
      }
      state={state}
      footer={<PanelLink onClick={() => router.push("/calendar")}>{t("overview.timeline.all")}</PanelLink>}
    >
      <div ref={fitRef} className="ov-fit">
        <Timeline
          items={items.slice(0, fitCount)}
          label={t("overview.timeline.label")}
          onSelect={(id) => router.push(taskIds.has(id) ? `/tasks?task=${encodeURIComponent(id)}` : `/calendar?event=${encodeURIComponent(id)}`)}
        />
      </div>
    </PanelFrame>
  );
}

/* ── Quick commands ───────────────────────────────────────────────────── */

const QUICK_ICONS: Record<string, ReactNode> = {
  plus: <Plus {...ICON} />,
  calendar: <CalendarDays {...ICON} />,
  mic: <Mic {...ICON} />,
  "file-text": <FileText {...ICON} />,
  briefing: <FileText {...ICON} />,
  mail: <Mail {...ICON} />,
  activity: <Activity {...ICON} />,
  pause: <Pause {...ICON} />,
  zap: <Zap {...ICON} />,
};

export function QuickCommandsPanel({ className, style }: PanelProps) {
  const { t } = useT();
  const router = useRouter();
  const run = useRunCommand();
  const openCreateTask = useCreateTaskDialog((s) => s.setOpen);
  const { capabilities, isLoading: capabilitiesLoading } = useCapabilities();
  const { overview, resolve } = useOverviewPanel(["quickCommands"]);
  const commands = overview?.quickCommands ?? [];
  const [fitRef, fitCount] = useFitCount<HTMLDivElement>(36, 5);
  const state = resolve({ empty: commands.length === 0, emptyTitle: t("overview.quick.empty") });
  return (
    <PanelFrame className={className} style={style} title={t("overview.quick.title")} state={state} skeletonRows={4}>
      <div ref={fitRef} className="ov-stack ov-stack--tight ov-stack--fill">
        {commands.slice(0, fitCount).map((command) => {
          // Server flag AND the capability document must agree; a missing capability disables the command with a reason.
          const capability = capabilityPathState(capabilities, command.requiredCapability);
          const enabled = command.enabled && (capabilitiesLoading || capability === "available");
          const reason = !command.enabled
            ? (command.disabledReason ?? t("overview.quick.unavailable"))
            : capability === "read-only"
              ? t("overview.quick.readOnly")
              : capability === "missing" && !capabilitiesLoading
                ? t("command.capabilityMissing")
                : undefined;
          const activate = (): void => {
            if (command.targetRoute?.startsWith("/tasks?new=1")) openCreateTask(true);
            else if (command.commandText) void run({ text: command.commandText, source: "quick_command" });
            else if (command.targetRoute) router.push(command.targetRoute);
          };
          return (
            <ActivityRow
              key={command.id}
              icon={QUICK_ICONS[command.icon] ?? <Zap {...ICON} />}
              tone={enabled ? "cyan" : "muted"}
              title={command.label}
              meta={enabled ? undefined : reason}
              onClick={enabled ? activate : undefined}
              aria-disabled={enabled ? undefined : true}
              className={`ov-quick${enabled ? "" : " ov-quick--disabled"}`}
              data-capability={command.requiredCapability}
            />
          );
        })}
      </div>
    </PanelFrame>
  );
}

/* ── System monitor ───────────────────────────────────────────────────── */

export function SystemMonitorPanel({ className, style }: PanelProps) {
  const { t } = useT();
  const { overview, resolve } = useOverviewPanel(["system"]);
  const metrics = useSystemMetrics().data?.data;
  const summary = overview?.systemSummary;
  const storage = metrics?.storage.find((volume) => /^d:/i.test(volume.mount)) ?? metrics?.storage[0];
  const cpu = metrics?.cpu.usagePercent ?? summary?.cpuPercent ?? null;
  const ram = metrics?.ram.usagePercent ?? summary?.ramPercent ?? null;
  const gpu = metrics?.gpu?.usagePercent ?? summary?.gpuPercent ?? null;
  const vram = metrics?.vram?.usagePercent ?? summary?.vramPercent ?? null;
  const disk = storage?.usagePercent ?? summary?.storageUsedPercent ?? null;
  const unavailable = t("common.unavailable");
  const state = resolve();
  const short = useMediaQuery("(min-width: 1100px) and (max-height: 960px)");
  const gauge = short ? 68 : 86;
  // Services with problems first; the rest is summarised so the panel keeps its height on small screens.
  const sortedServices = [...(summary?.services ?? [])].sort((a, b) => Number(a.status === "online") - Number(b.status === "online"));
  const visibleServices = sortedServices.slice(0, short ? MAX_SERVICE_CHIPS_SHORT : MAX_SERVICE_CHIPS);
  const hiddenServices = sortedServices.length - visibleServices.length;

  return (
    <PanelFrame className={className} style={style} title={t("overview.system.title")} state={state}>
      <div className="ov-monitor">
        <div className="ov-gauges">
          <CircularMetric label="CPU" value={cpu} size={gauge} nullReason={unavailable} />
          <CircularMetric label="RAM" value={ram} size={gauge} nullReason={unavailable} />
          <CircularMetric label="GPU" value={gpu} size={gauge} nullReason={t("overview.system.noGpu")} caption={vram !== null ? `VRAM ${Math.round(vram)} %` : undefined} />
          <CircularMetric label={storage?.mount ?? "D:\\"} value={disk} size={gauge} nullReason={t("overview.system.noDisk")} />
        </div>
        <ul className="ov-services" aria-label={t("overview.system.services")}>
          {visibleServices.map((service) => (
            <li key={service.id}>
              <StatusChip tone={toneFromHealth(service.status)}>
                {service.name}
                <span className="ov-services__state"> · {t(`service.${service.status}` as MessageKey)}</span>
              </StatusChip>
            </li>
          ))}
          {hiddenServices > 0 ? (
            <li>
              <StatusChip tone="muted" dot={false} title={t("overview.system.moreServices", { count: hiddenServices })}>
                +{hiddenServices}
              </StatusChip>
            </li>
          ) : null}
        </ul>
      </div>
    </PanelFrame>
  );
}

/* ── Memory insights ──────────────────────────────────────────────────── */

export function MemoryInsightsPanel({ className, style }: PanelProps) {
  const { t, locale } = useT();
  const router = useRouter();
  const { timeZone, hour12 } = useAppSettings();
  const { overview, resolve } = useOverviewPanel(["memory"]);
  const insights = overview?.memoryInsights;
  const number = new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-GB");

  const sample = useQuery({ ...memoryQueries.list({ limit: 16 }), enabled: Boolean(insights) });
  const projects = useQuery({ ...memoryQueries.list({ type: ["project"], limit: 1 }), enabled: Boolean(insights) });
  const people = useQuery({ ...memoryQueries.list({ type: ["person"], limit: 1 }), enabled: Boolean(insights) });

  const { nodes, edges } = useMemo(() => {
    const memories = sample.data?.items ?? [];
    const graphNodes: GraphNode[] = memories.map((memory) => ({ id: memory.id, weight: memory.confidence, label: memory.title }));
    const byEntity = new Map<string, string[]>();
    for (const memory of memories) for (const entity of memory.entities) byEntity.set(entity.id, [...(byEntity.get(entity.id) ?? []), memory.id]);
    const graphEdges: (readonly [string, string])[] = [];
    for (const ids of byEntity.values()) for (let i = 1; i < ids.length && graphEdges.length < 30; i += 1) graphEdges.push([ids[i - 1] as string, ids[i] as string]);
    return { nodes: graphNodes, edges: graphEdges };
  }, [sample.data]);

  const linked = (projects.data?.pageInfo.totalCount ?? null) !== null || (people.data?.pageInfo.totalCount ?? null) !== null ? (projects.data?.pageInfo.totalCount ?? 0) + (people.data?.pageInfo.totalCount ?? 0) : null;
  const state = resolve({ missing: overview !== undefined && insights === null });

  return (
    <PanelFrame
      className={className}
      style={style}
      title={t("overview.memory.title")}
      state={state}
      footer={<PanelLink onClick={() => router.push("/memory")}>{t("overview.memory.open")}</PanelLink>}
    >
      <div className="ov-memory">
        {nodes.length > 0 ? (
          <ConstellationGraph className="ov-memory__graph" nodes={nodes} edges={edges} summary={t("overview.memory.graph", { count: nodes.length })} seed={11} />
        ) : (
          <div className="ov-memory__graph ov-memory__graph--empty">{sample.isPending ? t("common.loading") : t("overview.memory.noGraph")}</div>
        )}
        <dl className="ov-memory__stats">
          <div>
            <dt>{t("overview.memory.entries")}</dt>
            <dd>{insights ? number.format(insights.total) : "—"}</dd>
          </div>
          <div>
            <dt>{t("overview.memory.newToday")}</dt>
            <dd>{insights ? `+${number.format(insights.newToday)}` : "—"}</dd>
          </div>
          <div>
            <dt>{t("overview.memory.linked")}</dt>
            <dd>{linked === null ? "—" : number.format(linked)}</dd>
          </div>
          <div>
            <dt>{t("overview.memory.updated")}</dt>
            <dd>{insights && !insights.lastUpdatedAt ? t("overview.memory.neverUpdated") : formatClockTime(insights?.lastUpdatedAt, { locale, timeZone, hour12 })}</dd>
          </div>
        </dl>
      </div>
    </PanelFrame>
  );
}

/* ── Models & services ────────────────────────────────────────────────── */

function providerStatus(status: ModelProvider["status"]): ProviderStatus {
  switch (status) {
    case "online":
      return "connected";
    case "degraded":
      return "degraded";
    case "offline":
      return "error";
    default:
      return "not-linked";
  }
}

export function ModelsServicesPanel({ className, style }: PanelProps) {
  const { t } = useT();
  const router = useRouter();
  const { overview, resolve } = useOverviewPanel(["models", "services"]);
  const cards = useMemo(() => {
    if (!overview) return [];
    const providers = overview.models.map((model) => ({
      id: model.id,
      name: model.name,
      icon: model.providerKind === "local" ? <Cpu {...ICON} /> : <Sparkles {...ICON} />,
      status: providerStatus(model.status),
      tone: (model.providerKind === "local" ? "teal" : "cyan") as Tone,
      detail: model.latencyMs !== null ? `${Math.round(model.latencyMs)} ms` : model.models[0],
    }));
    const known = new Set(providers.map((p) => p.name.toLowerCase()));
    const services = overview.systemSummary.services
      .filter((service) => !known.has(service.name.toLowerCase()))
      .map((service) => ({
        id: service.id,
        name: service.name,
        icon: /voice|stt|tts/i.test(service.name) ? <Mic {...ICON} /> : /hermes|agent/i.test(service.name) ? <Bot {...ICON} /> : <Server {...ICON} />,
        status: providerStatus(service.status),
        tone: toneFromHealth(service.status),
        detail: undefined as string | undefined,
      }));
    return [...providers, ...services].slice(0, 6);
  }, [overview]);
  const connected = overview ? overview.models.filter((m) => m.status === "online").length : 0;
  const state = resolve({ empty: cards.length === 0, emptyTitle: t("overview.models.empty") });
  return (
    <PanelFrame
      className={className}
      style={style}
      title={t("overview.models.title")}
      actions={<span className="ov-count">{t("overview.models.connected", { count: connected })}</span>}
      state={state}
      footer={<PanelLink onClick={() => router.push("/settings")}>{t("overview.models.manage")}</PanelLink>}
    >
      <div className="ov-providers">
        {cards.map((card) => (
          <ProviderCard
            key={card.id}
            name={card.name}
            icon={card.icon}
            status={card.status}
            statusLabel={t(`provider.${card.status}` as MessageKey)}
            detail={card.detail}
            tone={card.tone}
            onClick={() => router.push("/system")}
          />
        ))}
      </div>
    </PanelFrame>
  );
}
