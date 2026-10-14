"use client";

import type { Agent } from "@jarvis/sdk";
import { isJarvisApiError } from "@jarvis/sdk";
import { ActivityRow, Button, CircularMetric, ConfirmDialog, Drawer, EmptyState, ErrorState, MetricCard, Skeleton, TagPill, Tabs, cx, type TabItem } from "@jarvis/ui";
import { Activity, ExternalLink, Pause, Play, Square, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { fallbackKindIcon, KIND_ICON, SEVERITY_TONE } from "@/features/activity/model";
import { StatusChip } from "@/features/tasks/TaskCard";
import { CopyButton, DataOrigin, FactList, GatedButton, useDateFormatter } from "@/features/tasks/moduleKit";
import { useT, type MessageKey } from "@/i18n";
import { useActivity } from "@/lib/api/domains/activity";
import { useAgent } from "@/lib/api/domains/agents";
import { useCapabilityState } from "@/lib/capabilities";
import { useTask, useTasks } from "@/lib/api/domains/tasks";
import { AssignTaskDialog } from "./AssignTaskDialog";
import { AGENT_STATUS_TONE, displayConfiguration, heartbeatDelayed, successPercent } from "./model";
import { useAgentActionStates, useAgentCommands } from "./useAgentCommands";
import "./agents.css";

export const AGENT_TABS = ["overview", "capabilities", "task", "history", "tools", "performance", "errors", "configuration"] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

function TabEmpty({ title }: { title: string }) {
  return <EmptyState compact title={title} />;
}

function OverviewTab({ agent }: { agent: Agent }) {
  const { t } = useT();
  const format = useDateFormatter();
  const delayed = heartbeatDelayed(agent, format.now);
  return (
    <div className="ag-tab">
      {agent.description ? <p className="tk-text">{agent.description}</p> : null}
      <FactList
        items={[
          { label: t("agents.field.role"), value: agent.role },
          { label: t("agents.field.status"), value: t(`agent.status.${agent.status}` as MessageKey) },
          { label: t("agents.field.model"), value: agent.model ?? "—" },
          { label: t("agents.field.reasoning"), value: t(`agents.reasoning.${agent.reasoningLevel}` as MessageKey) },
          { label: t("agents.field.started"), value: format.dateTime(agent.startedAt) },
          { label: t("agents.field.runtime"), value: format.duration(agent.runtimeMs) },
          {
            label: t("agents.field.heartbeat"),
            value: (
              <span className={cx(delayed && "jv-tone-amber")}>
                {agent.heartbeatAt ? `${format.dateTime(agent.heartbeatAt)} · ${format.relative(agent.heartbeatAt)}` : "—"}
                {delayed ? ` · ${t("agents.card.heartbeatDelayed")}` : ""}
              </span>
            ),
          },
          { label: t("agents.field.lastActivity"), value: format.relative(agent.lastActivityAt) },
          { label: t("agents.field.created"), value: format.dateTime(agent.createdAt) },
          { label: t("agents.field.version"), value: <code>{agent.version}</code> },
        ]}
      />
    </div>
  );
}

function CapabilitiesTab({ agent }: { agent: Agent }) {
  const { t } = useT();
  if (agent.capabilities.length === 0) return <TabEmpty title={t("agents.capabilities.empty")} />;
  return (
    <div className="ag-tab">
      <ul className="ag-chiplist" aria-label={t("agents.field.capabilities")}>
        {agent.capabilities.map((capability) => (
          <li key={capability}>
            <TagPill tone="cyan">{capability}</TagPill>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CurrentTaskTab({ agent }: { agent: Agent }) {
  const { t } = useT();
  const router = useRouter();
  const query = useTask(agent.currentTaskId);
  if (!agent.currentTaskId) return <TabEmpty title={t("agents.task.none")} />;
  if (query.isPending) return <Skeleton variant="row" height={60} label={t("common.loading")} />;
  if (query.isError) return <ErrorState compact title={t("common.loadError")} onRetry={() => void query.refetch()} retryLabel={t("common.retry")} />;
  const task = query.data.data;
  return (
    <div className="ag-tab">
      <article className="jv-card ag-task">
        <div className="ag-task__head">
          <strong>{task.title}</strong>
          <StatusChip status={task.status} />
        </div>
        {task.description ? <p className="tk-list__text">{task.description}</p> : null}
        <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => router.push(`/tasks?task=${encodeURIComponent(task.id)}`)}>
          {t("agents.task.open")}
        </Button>
      </article>
    </div>
  );
}

function HistoryTab({ agent }: { agent: Agent }) {
  const { t } = useT();
  const router = useRouter();
  const format = useDateFormatter();
  const tasks = useTasks({ agentId: agent.id, limit: 20, sort: "-updatedAt" });
  const activity = useActivity({ agentId: agent.id, limit: 20 });
  return (
    <div className="ag-tab">
      <section className="ag-tab__block" aria-label={t("agents.history.tasks")}>
        <h3 className="tk-tab__h">{t("agents.history.tasks")}</h3>
        {tasks.isPending ? (
          <Skeleton variant="row" height={44} label={t("common.loading")} />
        ) : tasks.isError ? (
          <ErrorState compact title={t("common.loadError")} onRetry={() => void tasks.refetch()} retryLabel={t("common.retry")} />
        ) : tasks.data.items.length === 0 ? (
          <TabEmpty title={t("agents.history.noTasks")} />
        ) : (
          <ul className="tk-list tk-list--flush">
            {tasks.data.items.map((task) => (
              <li key={task.id} className="tk-list__item tk-list__item--row">
                <StatusChip status={task.status} />
                <button type="button" className="tk-card__title" onClick={() => router.push(`/tasks?task=${encodeURIComponent(task.id)}`)}>
                  {task.title}
                </button>
                <span className="tk-muted">{format.relative(task.updatedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="ag-tab__block" aria-label={t("agents.history.activity")}>
        <h3 className="tk-tab__h">{t("agents.history.activity")}</h3>
        {activity.isPending ? (
          <Skeleton variant="row" height={44} label={t("common.loading")} />
        ) : activity.isError ? (
          <ErrorState compact title={t("common.loadError")} onRetry={() => void activity.refetch()} retryLabel={t("common.retry")} />
        ) : activity.data.items.length === 0 ? (
          <TabEmpty title={t("agents.history.noActivity")} />
        ) : (
          <div className="tk-rows tk-rows--flush">
            {activity.data.items.map((event) => (
              <ActivityRow
                key={event.id}
                icon={KIND_ICON[event.kind] ?? fallbackKindIcon}
                title={event.title}
                meta={event.summary ?? event.tool ?? undefined}
                tone={SEVERITY_TONE[event.severity]}
                tag={t(`activity.severity.${event.severity}` as MessageKey)}
                time={format.time(event.occurredAt)}
                onClick={() => router.push(`/activity?event=${encodeURIComponent(event.id)}`)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ToolsTab({ agent }: { agent: Agent }) {
  const { t } = useT();
  const activity = useActivity({ agentId: agent.id, kind: ["tool_call"], limit: 50 });
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of activity.data?.items ?? []) if (event.tool) counts.set(event.tool, (counts.get(event.tool) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [activity.data]);
  return (
    <div className="ag-tab">
      <section className="ag-tab__block" aria-label={t("agents.field.activeTools")}>
        <h3 className="tk-tab__h">{t("agents.field.activeTools")}</h3>
        {agent.activeTools.length === 0 ? (
          <p className="tk-muted">{t("agents.tools.none")}</p>
        ) : (
          <ul className="ag-chiplist">
            {agent.activeTools.map((tool) => (
              <li key={tool}>
                <TagPill tone="violet" className="tk-mono">
                  {tool}
                </TagPill>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="ag-tab__block" aria-label={t("agents.tools.recent")}>
        <h3 className="tk-tab__h">{t("agents.tools.recent")}</h3>
        {activity.isPending ? (
          <Skeleton variant="row" height={40} label={t("common.loading")} />
        ) : usage.length === 0 ? (
          <p className="tk-muted">{t("agents.tools.noCalls")}</p>
        ) : (
          <ul className="tk-list tk-list--flush">
            {usage.map(([tool, count]) => (
              <li key={tool} className="tk-list__item tk-list__item--row">
                <span className="tk-list__title tk-mono">{tool}</span>
                <span className="tk-muted">{t("agents.tools.calls", { count })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PerformanceTab({ agent }: { agent: Agent }) {
  const { t, locale } = useT();
  const format = useDateFormatter();
  const { performance } = agent;
  const number = new Intl.NumberFormat(locale);
  return (
    <div className="ag-tab">
      <div className="ag-perf">
        <CircularMetric value={successPercent(agent)} label={t("agents.field.successRate")} tone="green" thresholds={[0, 0]} nullReason={t("agents.perf.noRate")} />
        <MetricCard label={t("agents.perf.completed")} value={number.format(performance.tasksCompleted)} tone="green" />
        <MetricCard label={t("agents.perf.failed")} value={number.format(performance.tasksFailed)} tone={performance.tasksFailed > 0 ? "red" : "muted"} />
        <MetricCard label={t("agents.perf.avgDuration")} value={performance.avgTaskDurationMs === null ? null : format.duration(performance.avgTaskDurationMs)} nullReason={t("agents.perf.noValue")} />
        <MetricCard label={t("agents.perf.tokens")} value={performance.tokensUsed === undefined ? null : number.format(performance.tokensUsed)} nullReason={t("agents.perf.noValue")} />
        <MetricCard label={t("agents.perf.cost")} value={performance.costEur === undefined ? null : new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(performance.costEur)} nullReason={t("agents.perf.noValue")} />
      </div>
    </div>
  );
}

function ErrorsTab({ agent }: { agent: Agent }) {
  const { t } = useT();
  const router = useRouter();
  const format = useDateFormatter();
  const events = useActivity({ agentId: agent.id, severity: ["error", "critical"], limit: 20 });
  return (
    <div className="ag-tab">
      {agent.lastError ? (
        <section className="ag-tab__block" aria-label={t("agents.field.lastError")}>
          <h3 className="tk-tab__h">{t("agents.field.lastError")}</h3>
          <div className="tk-list__item">
            <div className="tk-list__head">
              <TagPill tone="red">{agent.lastError.code}</TagPill>
              <span className="tk-list__aside">{agent.lastError.retryable ? t("tasks.errors.retryable") : t("tasks.errors.final")}</span>
            </div>
            <p className="tk-list__text">{agent.lastError.message}</p>
            <div className="tk-list__foot">
              <code>{agent.lastError.correlationId}</code>
              <CopyButton value={agent.lastError.correlationId} label={t("tasks.copyCorrelation")} />
            </div>
          </div>
        </section>
      ) : null}
      <section className="ag-tab__block" aria-label={t("agents.errors.events")}>
        <h3 className="tk-tab__h">{t("agents.errors.events")}</h3>
        {events.isPending ? (
          <Skeleton variant="row" height={44} label={t("common.loading")} />
        ) : events.isError ? (
          <ErrorState compact title={t("common.loadError")} onRetry={() => void events.refetch()} retryLabel={t("common.retry")} />
        ) : events.data.items.length === 0 && !agent.lastError ? (
          <TabEmpty title={t("agents.errors.none")} />
        ) : (
          <div className="tk-rows tk-rows--flush">
            {events.data.items.map((event) => (
              <ActivityRow
                key={event.id}
                icon={KIND_ICON[event.kind] ?? fallbackKindIcon}
                title={event.title}
                meta={event.error?.message ?? event.summary}
                tone={SEVERITY_TONE[event.severity]}
                tag={t(`activity.severity.${event.severity}` as MessageKey)}
                time={format.time(event.occurredAt)}
                onClick={() => router.push(`/activity?event=${encodeURIComponent(event.id)}`)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ConfigurationTab({ agent }: { agent: Agent }) {
  const { t } = useT();
  const entries = displayConfiguration(agent.configuration);
  if (entries.length === 0) return <TabEmpty title={t("agents.config.empty")} />;
  return (
    <div className="ag-tab">
      <p className="tk-muted">{t("agents.config.readonly")}</p>
      <FactList items={entries.map((entry) => ({ label: entry.key, value: entry.masked ? <span title={t("agents.config.masked")}>{entry.value}</span> : entry.value, wide: true }))} />
    </div>
  );
}

export interface AgentDrawerProps {
  agentId: string | null;
  tab: AgentTab;
  onTabChange: (tab: AgentTab) => void;
  onClose: () => void;
}

/** Detail drawer of `/agents?agent=…` with the eight tabs of PLAN §31.2 and the actions of §31.3. */
export function AgentDrawer({ agentId, tab, onTabChange, onClose }: AgentDrawerProps) {
  const { t } = useT();
  const router = useRouter();
  const query = useAgent(agentId);
  const agent = query.data?.data;
  const states = useAgentActionStates(agent);
  const activityGate = useCapabilityState("activity", "read");
  const commands = useAgentCommands();
  const [confirmStop, setConfirmStop] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const tabs = useMemo<TabItem[]>(() => {
    if (!agent) return [];
    return [
      { id: "overview", label: t("agents.tab.overview"), content: <OverviewTab agent={agent} /> },
      { id: "capabilities", label: t("agents.tab.capabilities"), count: agent.capabilities.length, content: <CapabilitiesTab agent={agent} /> },
      { id: "task", label: t("agents.tab.task"), content: <CurrentTaskTab agent={agent} /> },
      { id: "history", label: t("agents.tab.history"), content: <HistoryTab agent={agent} /> },
      { id: "tools", label: t("agents.tab.tools"), count: agent.activeTools.length, content: <ToolsTab agent={agent} /> },
      { id: "performance", label: t("agents.tab.performance"), content: <PerformanceTab agent={agent} /> },
      { id: "errors", label: t("agents.tab.errors"), content: <ErrorsTab agent={agent} /> },
      { id: "configuration", label: t("agents.tab.configuration"), content: <ConfigurationTab agent={agent} /> },
    ];
  }, [agent, t]);

  let body: ReactNode = null;
  if (agentId && query.isPending) body = <Skeleton variant="block" height={220} label={t("common.loading")} />;
  else if (query.isError) {
    body =
      isJarvisApiError(query.error) && query.error.code === "NOT_FOUND" ? (
        <EmptyState compact title={t("agents.drawer.notFound")} description={t("agents.drawer.notFoundHint")} />
      ) : (
        <ErrorState compact title={t("common.loadError")} description={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} retryLabel={t("common.retry")} />
      );
  } else if (agent)
    body = (
      <>
        <div className="mod-heading">
          <DataOrigin sources={[agent.source]} freshness={query.data?.freshness} />
        </div>
        <Tabs label={t("agents.drawer.tabs")} items={tabs} value={tab} onValueChange={(next) => onTabChange(next as AgentTab)} />
      </>
    );

  const footer = agent ? (
    <div className="ag-actions" role="group" aria-label={t("agents.drawer.actions")}>
      <GatedButton size="sm" variant="ghost" icon={<Pause size={14} />} gate={states.pause.gate} blockedReason={states.pause.blockedReason} disabled={commands.pending} onClick={() => commands.run("pause", agent)}>
        {t("agents.action.pause")}
      </GatedButton>
      <GatedButton size="sm" variant="ghost" icon={<Play size={14} />} gate={states.resume.gate} blockedReason={states.resume.blockedReason} disabled={commands.pending} onClick={() => commands.run("resume", agent)}>
        {t("agents.action.resume")}
      </GatedButton>
      <GatedButton size="sm" variant="danger" icon={<Square size={14} />} gate={states.stop.gate} blockedReason={states.stop.blockedReason} disabled={commands.pending} onClick={() => setConfirmStop(true)}>
        {t("agents.action.stop")}
      </GatedButton>
      <GatedButton size="sm" variant="primary" icon={<UserPlus size={14} />} gate={states.assignTask.gate} blockedReason={states.assignTask.blockedReason} onClick={() => setAssignOpen(true)}>
        {t("agents.action.assign")}
      </GatedButton>
      <GatedButton size="sm" variant="ghost" icon={<Activity size={14} />} gate={activityGate} onClick={() => router.push(`/activity?agent=${encodeURIComponent(agent.id)}`)}>
        {t("agents.action.activity")}
      </GatedButton>
    </div>
  ) : null;

  return (
    <>
      <Drawer
        open={agentId !== null}
        onOpenChange={(open) => !open && onClose()}
        title={agent?.name ?? t("agents.drawer.title")}
        subtitle={
          agent ? (
            <span className="tk-drawer__sub">
              <span className={cx("ag-card__status", `jv-tone-${AGENT_STATUS_TONE[agent.status]}`)}>{t(`agent.status.${agent.status}` as MessageKey)}</span>
              <code>{agent.id}</code>
            </span>
          ) : undefined
        }
        width={640}
        className="mod-drawer"
        closeLabel={t("common.close")}
        footer={footer}
      >
        {body}
      </Drawer>
      {agent ? (
        <>
          <ConfirmDialog
            open={confirmStop}
            onOpenChange={setConfirmStop}
            title={t("agents.stop.title")}
            description={t("agents.stop.description", { agent: agent.name })}
            details={[t("agents.stop.detailTask"), t("agents.stop.detailHistory")]}
            confirmLabel={t("agents.stop.confirm")}
            cancelLabel={t("common.cancel")}
            tone="danger"
            loading={commands.pending}
            onConfirm={() => {
              commands.run("stop", agent);
              setConfirmStop(false);
            }}
          />
          <AssignTaskDialog agent={agent} open={assignOpen} onOpenChange={setAssignOpen} />
        </>
      ) : null}
    </>
  );
}
