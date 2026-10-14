import { AlertOctagon, AlertTriangle, BellRing, Check, Clock3, Info, Lightbulb, Lock, ShieldAlert, X } from 'lucide-react';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../cx';
import type { Capability, Severity, Tone } from '../types';
import { severityTone } from '../types';
import { Button, IconTile, StatusDot, TagPill } from './Primitives';
import { Waveform } from './Waveform';

/* ── shared: clickable card behaviour ───────────────────────────────────── */

interface CardBase extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'onClick'> {
  onClick?: () => void;
  selected?: boolean;
}

function interactiveProps(onClick: (() => void) | undefined) {
  if (!onClick) return {};
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick();
      }
    },
  };
}

/* ── AgentCard ──────────────────────────────────────────────────────────── */

export type AgentStatus = 'active' | 'standby' | 'busy' | 'blocked' | 'error' | 'offline';

const agentStatusTone: Record<AgentStatus, Tone> = {
  active: 'green',
  standby: 'amber',
  busy: 'cyan',
  blocked: 'red',
  error: 'red',
  offline: 'muted',
};

export const defaultAgentStatusLabels: Record<AgentStatus, string> = {
  active: 'Aktiv',
  standby: 'Bereit',
  busy: 'Beschäftigt',
  blocked: 'Blockiert',
  error: 'Fehler',
  offline: 'Offline',
};

export interface AgentCardProps extends CardBase {
  name: string;
  icon: ReactNode;
  /** Agent identity colour (icon tile + activity trace). */
  tone?: Tone;
  status: AgentStatus;
  statusLabel?: string;
  /** Current task, one line. */
  task?: string;
  /** Fixed activity levels (0..1). Omit to use a generated live trace for active agents. */
  levels?: readonly number[];
  /** Seed so each agent has its own trace. */
  seed?: number;
}

export const AgentCard = forwardRef<HTMLDivElement, AgentCardProps>(function AgentCard(
  { name, icon, tone = 'cyan', status, statusLabel, task, levels, seed = 1, onClick, selected, className, ...rest },
  ref,
) {
  const statusTone = agentStatusTone[status];
  const live = status === 'active' || status === 'busy';
  const label = statusLabel ?? defaultAgentStatusLabels[status];
  return (
    <div
      ref={ref}
      className={cx('jv-card jv-agent', `jv-tone-${tone}`, selected && 'jv-card--selected', onClick && 'jv-card--clickable', className)}
      data-status={status}
      aria-current={selected || undefined}
      {...interactiveProps(onClick)}
      {...rest}
    >
      <IconTile icon={icon} tone={tone} size="lg" active={live} />
      <div className="jv-agent__main">
        <span className="jv-agent__name" title={name}>
          {name}
        </span>
        <div className="jv-agent__line">
          <span className={cx('jv-agent__status', `jv-tone-${statusTone}`)}>
            <StatusDot tone={statusTone} pulse={status === 'active'} />
            {label}
          </span>
          <span className="jv-agent__trace" aria-hidden="true">
            <Waveform
              levels={levels}
              live={live}
              variant={live ? 'mirror' : 'dots'}
              energy={live ? 0.75 : 0.18}
              tone={tone}
              height={22}
              fade="left"
              seed={seed}
              barWidth={2}
              barGap={2}
            />
          </span>
        </div>
        {task ? (
          <span className="jv-agent__task" title={task}>
            {task}
          </span>
        ) : null}
      </div>
    </div>
  );
});

/* ── ProviderCard ───────────────────────────────────────────────────────── */

export type ProviderStatus = 'connected' | 'not-linked' | 'degraded' | 'error' | 'no-models';

const providerTone: Record<ProviderStatus, Tone> = {
  connected: 'green',
  'not-linked': 'muted',
  degraded: 'amber',
  error: 'red',
  'no-models': 'muted',
};

export const defaultProviderLabels: Record<ProviderStatus, string> = {
  connected: 'Verbunden',
  'not-linked': 'Nicht verknüpft',
  degraded: 'Eingeschränkt',
  error: 'Fehler',
  'no-models': 'Keine Modelle',
};

export interface ProviderCardProps extends CardBase {
  name: string;
  icon: ReactNode;
  status: ProviderStatus;
  statusLabel?: string;
  /** Secondary info, e.g. "42 ms" or "Qwen 3 · lokal". */
  detail?: string;
  tone?: Tone;
}

export const ProviderCard = forwardRef<HTMLDivElement, ProviderCardProps>(function ProviderCard(
  { name, icon, status, statusLabel, detail, tone, onClick, selected, className, ...rest },
  ref,
) {
  const sTone = providerTone[status];
  return (
    <div
      ref={ref}
      className={cx('jv-card jv-provider', selected && 'jv-card--selected', onClick && 'jv-card--clickable', className)}
      data-status={status}
      {...interactiveProps(onClick)}
      {...rest}
    >
      <IconTile icon={icon} tone={tone ?? (status === 'connected' ? 'cyan' : 'muted')} size="md" />
      <div className="jv-provider__main">
        <span className="jv-provider__name" title={name}>
          {name}
        </span>
        <span className={cx('jv-provider__status', `jv-tone-${sTone}`)}>{statusLabel ?? defaultProviderLabels[status]}</span>
        {detail ? <span className="jv-provider__detail">{detail}</span> : null}
      </div>
    </div>
  );
});

/* ── TaskCard ───────────────────────────────────────────────────────────── */

export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'review' | 'done';
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';

const priorityTone: Record<TaskPriority, Tone> = { P0: 'red', P1: 'amber', P2: 'cyan', P3: 'muted' };
const taskStatusTone: Record<TaskStatus, Tone> = { todo: 'muted', doing: 'cyan', blocked: 'red', review: 'violet', done: 'green' };
export const defaultTaskStatusLabels: Record<TaskStatus, string> = {
  todo: 'Offen',
  doing: 'In Arbeit',
  blocked: 'Blockiert',
  review: 'Review',
  done: 'Erledigt',
};

export interface TaskCardProps extends CardBase {
  title: string;
  status: TaskStatus;
  statusLabel?: string;
  priority?: TaskPriority;
  project?: string;
  assignee?: string;
  due?: string;
  overdue?: boolean;
  /** 0..100, or null when progress is not known (indeterminate — never fake). */
  progress?: number | null;
  blockedReason?: string;
  tags?: readonly string[];
  /** Capability for editing: renders a lock hint when not 'available'. */
  capability?: Capability;
}

export const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(function TaskCard(
  { title, status, statusLabel, priority, project, assignee, due, overdue, progress, blockedReason, tags, capability = 'available', onClick, selected, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx('jv-card jv-task', selected && 'jv-card--selected', onClick && 'jv-card--clickable', className)}
      data-status={status}
      {...interactiveProps(onClick)}
      {...rest}
    >
      <div className="jv-task__top">
        {priority ? <TagPill tone={priorityTone[priority]}>{priority}</TagPill> : null}
        <span className="jv-task__title" title={title}>
          {title}
        </span>
        {capability !== 'available' ? (
          <span className="jv-task__lock" title={capability === 'read-only' ? 'Nur Lesezugriff' : 'Funktion nicht verfügbar'}>
            <Lock size={12} strokeWidth={1.75} aria-hidden="true" />
            <span className="jv-sr-only">{capability === 'read-only' ? 'Nur Lesezugriff' : 'Funktion nicht verfügbar'}</span>
          </span>
        ) : null}
      </div>
      <div className="jv-task__meta">
        <span className={cx('jv-task__status', `jv-tone-${taskStatusTone[status]}`)}>
          <StatusDot tone={taskStatusTone[status]} />
          {statusLabel ?? defaultTaskStatusLabels[status]}
        </span>
        {project ? <span className="jv-task__project">{project}</span> : null}
        {due ? (
          <span className={cx('jv-task__due', overdue && 'jv-tone-red')}>
            <Clock3 size={11} strokeWidth={1.75} aria-hidden="true" />
            {overdue ? <span className="jv-sr-only">Überfällig: </span> : null}
            {due}
          </span>
        ) : null}
        {assignee ? <span className="jv-task__assignee">{assignee}</span> : null}
      </div>
      {status === 'blocked' && blockedReason ? (
        <div className="jv-task__blocked">
          <AlertTriangle size={12} strokeWidth={1.75} aria-hidden="true" />
          {blockedReason}
        </div>
      ) : null}
      {progress !== undefined ? (
        <div
          className={cx('jv-progress', progress === null && 'jv-progress--indeterminate')}
          role="progressbar"
          aria-label={`${title}: Fortschritt`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress === null ? undefined : Math.round(progress)}
          aria-valuetext={progress === null ? 'Fortschritt unbekannt' : `${Math.round(progress)} Prozent`}
        >
          <span className="jv-progress__bar" style={progress === null ? undefined : { width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      ) : null}
      {tags && tags.length > 0 ? (
        <div className="jv-task__tags">
          {tags.map((t) => (
            <TagPill key={t} tone="muted">
              {t}
            </TagPill>
          ))}
        </div>
      ) : null}
    </div>
  );
});

/* ── AlertCard ──────────────────────────────────────────────────────────── */

const severityIcon: Record<Severity, ReactNode> = {
  info: <Info size={16} strokeWidth={1.5} />,
  tip: <Lightbulb size={16} strokeWidth={1.5} />,
  warn: <AlertTriangle size={16} strokeWidth={1.5} />,
  critical: <AlertOctagon size={16} strokeWidth={1.5} />,
  live: <BellRing size={16} strokeWidth={1.5} />,
  ok: <Check size={16} strokeWidth={1.5} />,
};

export const defaultSeverityLabels: Record<Severity, string> = {
  info: 'INFO',
  tip: 'TIPP',
  warn: 'WARNUNG',
  critical: 'KRITISCH',
  live: 'LIVE',
  ok: 'OK',
};

export interface AlertCardProps extends CardBase {
  severity: Severity;
  title: string;
  description?: string;
  source?: string;
  time?: string;
  acknowledged?: boolean;
  onAcknowledge?: () => void;
  acknowledgeLabel?: string;
  capability?: Capability;
}

export const AlertCard = forwardRef<HTMLDivElement, AlertCardProps>(function AlertCard(
  { severity, title, description, source, time, acknowledged, onAcknowledge, acknowledgeLabel = 'Quittieren', capability = 'available', onClick, selected, className, ...rest },
  ref,
) {
  const tone = severityTone[severity];
  // A card that is a button must not contain another button: with an acknowledge action the card stays mouse-clickable
  // while the title becomes the keyboard-reachable button (axe: nested-interactive).
  const hasAction = Boolean(onAcknowledge && !acknowledged && capability !== 'missing');
  const titleButton = Boolean(onClick && hasAction);
  return (
    <div
      ref={ref}
      className={cx('jv-card jv-alert', `jv-tone-${tone}`, acknowledged && 'jv-alert--ack', selected && 'jv-card--selected', onClick && 'jv-card--clickable', className)}
      data-severity={severity}
      {...(titleButton ? { onClick } : interactiveProps(onClick))}
      {...rest}
    >
      <IconTile icon={severityIcon[severity]} tone={tone} size="md" active={severity === 'critical' && !acknowledged} />
      <div className="jv-alert__main">
        <div className="jv-alert__top">
          <TagPill tone={tone}>{defaultSeverityLabels[severity]}</TagPill>
          {titleButton ? (
            <button
              type="button"
              className="jv-alert__title jv-alert__title--button"
              title={title}
              onClick={(e) => {
                e.stopPropagation();
                onClick?.();
              }}
            >
              {title}
            </button>
          ) : (
            <span className="jv-alert__title" title={title}>
              {title}
            </span>
          )}
        </div>
        {description ? <p className="jv-alert__desc">{description}</p> : null}
        <div className="jv-alert__foot">
          {source ? <span>{source}</span> : null}
          {time ? <span className="jv-alert__time">{time}</span> : null}
          {acknowledged ? (
            <span className="jv-alert__ack">
              <Check size={11} strokeWidth={2} aria-hidden="true" /> Quittiert
            </span>
          ) : null}
        </div>
      </div>
      {onAcknowledge && !acknowledged && capability !== 'missing' ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={capability === 'read-only'}
          title={capability === 'read-only' ? 'Nur Lesezugriff' : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onAcknowledge();
          }}
        >
          {acknowledgeLabel}
        </Button>
      ) : null}
    </div>
  );
});

/* ── ApprovalCard ───────────────────────────────────────────────────────── */

export type ApprovalRisk = 'low' | 'medium' | 'high' | 'critical';
const riskTone: Record<ApprovalRisk, Tone> = { low: 'green', medium: 'cyan', high: 'amber', critical: 'red' };
export const defaultRiskLabels: Record<ApprovalRisk, string> = { low: 'Gering', medium: 'Mittel', high: 'Hoch', critical: 'Kritisch' };

export interface ApprovalCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: string;
  /** Plain-language description of what will happen ("Du bist dabei: …"). */
  description: string;
  requester?: string;
  risk: ApprovalRisk;
  /** Remaining time, e.g. "läuft in 12 Min. ab". */
  expires?: string;
  capability?: Capability;
  busy?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onDetails?: () => void;
  labels?: { approve?: string; reject?: string; details?: string };
}

export const ApprovalCard = forwardRef<HTMLDivElement, ApprovalCardProps>(function ApprovalCard(
  { title, description, requester, risk, expires, capability = 'available', busy, onApprove, onReject, onDetails, labels, className, ...rest },
  ref,
) {
  const tone = riskTone[risk];
  const blocked = capability !== 'available';
  return (
    <div ref={ref} className={cx('jv-card jv-approval', `jv-tone-${tone}`, className)} data-risk={risk} role="group" aria-label={`Freigabe: ${title}`} {...rest}>
      <div className="jv-approval__head">
        <IconTile icon={<ShieldAlert size={16} strokeWidth={1.5} />} tone={tone} size="md" active={risk === 'critical'} />
        <div className="jv-approval__titles">
          <span className="jv-approval__title">{title}</span>
          <span className="jv-approval__meta">
            {requester ? <span>{requester}</span> : null}
            {expires ? <span className="jv-approval__expires">{expires}</span> : null}
          </span>
        </div>
        <TagPill tone={tone}>{`Risiko: ${defaultRiskLabels[risk]}`}</TagPill>
      </div>
      <p className="jv-approval__desc">{description}</p>
      <div className="jv-approval__actions">
        {capability === 'missing' ? (
          <span className="jv-approval__note">
            <Lock size={12} strokeWidth={1.75} aria-hidden="true" /> Berechtigung fehlt – Freigabe nicht möglich
          </span>
        ) : (
          <>
            <Button size="sm" variant="primary" icon={<Check size={14} />} disabled={blocked || busy} loading={busy} onClick={onApprove}>
              {labels?.approve ?? 'Genehmigen'}
            </Button>
            <Button size="sm" variant="danger" icon={<X size={14} />} disabled={blocked || busy} onClick={onReject}>
              {labels?.reject ?? 'Ablehnen'}
            </Button>
            {capability === 'read-only' ? (
              <span className="jv-approval__note">
                <Lock size={12} strokeWidth={1.75} aria-hidden="true" /> Nur Lesezugriff
              </span>
            ) : null}
          </>
        )}
        {onDetails ? (
          <Button size="sm" variant="ghost" onClick={onDetails}>
            {labels?.details ?? 'Details'}
          </Button>
        ) : null}
      </div>
    </div>
  );
});

/* ── KanbanColumn ───────────────────────────────────────────────────────── */

export interface KanbanColumnProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: string;
  count?: number;
  /** WIP limit; the count turns amber when exceeded. */
  limit?: number;
  tone?: Tone;
  actions?: ReactNode;
  emptyLabel?: string;
}

/** Layout shell of a board column; cards (TaskCard) go in as children. */
export const KanbanColumn = forwardRef<HTMLElement, KanbanColumnProps>(function KanbanColumn(
  { title, count, limit, tone = 'cyan', actions, emptyLabel = 'Keine Einträge', className, children, ...rest },
  ref,
) {
  const over = limit !== undefined && count !== undefined && count > limit;
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section ref={ref} className={cx('jv-kanban', `jv-tone-${tone}`, className)} aria-label={title} {...rest}>
      <header className="jv-kanban__head">
        <StatusDot tone={tone} />
        <h3 className="jv-kanban__title">{title}</h3>
        {count !== undefined ? (
          <span className={cx('jv-kanban__count', over && 'jv-tone-amber')} aria-label={`${count} Einträge${limit !== undefined ? `, Limit ${limit}` : ''}`}>
            {count}
            {limit !== undefined ? <span className="jv-kanban__limit">/{limit}</span> : null}
          </span>
        ) : null}
        {actions ? <div className="jv-kanban__actions">{actions}</div> : null}
      </header>
      <div className="jv-kanban__body">
        {hasChildren ? children : <div className="jv-kanban__empty">{emptyLabel}</div>}
      </div>
    </section>
  );
});
