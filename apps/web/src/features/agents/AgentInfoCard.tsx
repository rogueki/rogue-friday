"use client";

import type { Agent } from "@jarvis/sdk";
import { IconTile, StatusDot, TagPill, Waveform, cx } from "@jarvis/ui";
import { AlertTriangle, Activity, Gauge, HeartPulse, ListChecks, Timer } from "lucide-react";
import { agentIconFor, agentTone } from "@/features/shared/presentation";
import { useDateFormatter } from "@/features/tasks/moduleKit";
import { useT, type MessageKey } from "@/i18n";
import { AGENT_STATUS_TONE, heartbeatDelayed, successPercent } from "./model";
import "./agents.css";

export interface AgentInfoCardProps {
  agent: Agent;
  index: number;
  taskTitle?: string;
  selected?: boolean;
  onOpen: (agent: Agent) => void;
}

const MAX_CHIPS = 4;

/** Agent card (PLAN §31.1): name, role, status, task, model, reasoning, capabilities, tools, runtime, heartbeat, rates, activity. */
export function AgentInfoCard({ agent, index, taskTitle, selected, onOpen }: AgentInfoCardProps) {
  const { t } = useT();
  const format = useDateFormatter();
  const tone = agentTone(agent.accent, index);
  const statusTone = AGENT_STATUS_TONE[agent.status];
  const live = agent.status === "working" || agent.status === "starting";
  const delayed = heartbeatDelayed(agent, format.now);
  const success = successPercent(agent);
  const { tasksCompleted, tasksFailed } = agent.performance;
  return (
    <article className={cx("jv-card ag-card", `jv-tone-${tone}`, selected && "jv-card--selected")} data-status={agent.status} aria-label={`${t("agents.card.label")}: ${agent.name}`}>
      <header className="ag-card__head">
        <IconTile icon={agentIconFor(agent.name, agent.role)} tone={tone} size="lg" active={live} />
        <div className="ag-card__titles">
          <button type="button" className="ag-card__name" onClick={() => onOpen(agent)}>
            {agent.name}
          </button>
          <span className="ag-card__role">{agent.role}</span>
        </div>
        <span className={cx("ag-card__status", `jv-tone-${statusTone}`)} data-status={agent.status}>
          <StatusDot tone={statusTone} pulse={agent.status === "working"} />
          {t(`agent.status.${agent.status}` as MessageKey)}
        </span>
      </header>

      <div className="ag-card__trace" aria-hidden="true">
        <Waveform live={live} variant={live ? "mirror" : "dots"} energy={live ? 0.7 : 0.15} tone={tone} height={22} fade="left" seed={index + 3} barWidth={2} barGap={2} />
      </div>

      <p className="ag-card__task">
        <ListChecks size={13} strokeWidth={1.75} aria-hidden="true" />
        <span className="jv-sr-only">{t("agents.field.currentTask")}: </span>
        {agent.currentTaskId ? (taskTitle ?? agent.currentTaskId) : t("agents.card.noTask")}
      </p>

      <dl className="ag-card__facts">
        <div>
          <dt>{t("agents.field.model")}</dt>
          <dd className="tk-mono">{agent.model ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("agents.field.reasoning")}</dt>
          <dd>{t(`agents.reasoning.${agent.reasoningLevel}` as MessageKey)}</dd>
        </div>
        <div>
          <dt>
            <Timer size={11} aria-hidden="true" /> {t("agents.field.runtime")}
          </dt>
          <dd>{format.duration(agent.runtimeMs)}</dd>
        </div>
        <div>
          <dt>
            <HeartPulse size={11} aria-hidden="true" /> {t("agents.field.heartbeat")}
          </dt>
          <dd className={cx(delayed && "jv-tone-amber")}>
            {agent.heartbeatAt ? format.relative(agent.heartbeatAt) : "—"}
            {delayed ? <span className="ag-card__warn"> · {t("agents.card.heartbeatDelayed")}</span> : null}
          </dd>
        </div>
        <div>
          <dt>
            <Gauge size={11} aria-hidden="true" /> {t("agents.field.successRate")}
          </dt>
          <dd>{success === null ? "—" : `${success} %`}</dd>
        </div>
        <div>
          <dt>
            <Activity size={11} aria-hidden="true" /> {t("agents.field.lastActivity")}
          </dt>
          <dd>{format.relative(agent.lastActivityAt)}</dd>
        </div>
        <div className="ag-card__wide">
          <dt>{t("agents.field.tasks")}</dt>
          <dd>{t("agents.card.taskCounts", { done: tasksCompleted, failed: tasksFailed })}</dd>
        </div>
      </dl>

      {agent.capabilities.length > 0 ? (
        <div className="ag-card__chips" aria-label={t("agents.field.capabilities")}>
          {agent.capabilities.slice(0, MAX_CHIPS).map((capability) => (
            <TagPill key={capability} tone="muted">
              {capability}
            </TagPill>
          ))}
          {agent.capabilities.length > MAX_CHIPS ? <TagPill tone="muted">+{agent.capabilities.length - MAX_CHIPS}</TagPill> : null}
        </div>
      ) : null}
      {agent.activeTools.length > 0 ? (
        <div className="ag-card__chips" aria-label={t("agents.field.activeTools")}>
          {agent.activeTools.slice(0, MAX_CHIPS).map((tool) => (
            <TagPill key={tool} tone="violet" className="tk-mono">
              {tool}
            </TagPill>
          ))}
          {agent.activeTools.length > MAX_CHIPS ? <TagPill tone="violet">+{agent.activeTools.length - MAX_CHIPS}</TagPill> : null}
        </div>
      ) : null}
      {agent.lastError ? (
        <p className="jv-task__blocked ag-card__error" role="note">
          <AlertTriangle size={12} strokeWidth={1.75} aria-hidden="true" />
          <span>
            <span className="jv-sr-only">{t("agents.field.lastError")}: </span>
            {agent.lastError.message}
          </span>
        </p>
      ) : null}
    </article>
  );
}
