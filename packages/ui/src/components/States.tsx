import { AlertOctagon, AlertTriangle, Check, Clock3, Copy, Inbox, RefreshCw, WifiOff } from 'lucide-react';
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../cx';
import type { Tone } from '../types';
import { Button, FreshnessBadge, IconTile } from './Primitives';

interface StateShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon: ReactNode;
  tone: Tone;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}

function StateShell({ icon, tone, title, description, children, compact, role = 'status', className, ...rest }: StateShellProps) {
  return (
    <div className={cx('jv-state', `jv-tone-${tone}`, compact && 'jv-state--compact', className)} role={role} aria-label={role === 'region' ? title : undefined} {...rest}>
      <IconTile icon={icon} tone={tone} size={compact ? 'md' : 'lg'} active={tone === 'red'} />
      <div className="jv-state__text">
        <strong className="jv-state__title">{title}</strong>
        {description ? <p className="jv-state__desc">{description}</p> : null}
      </div>
      {children ? <div className="jv-state__actions">{children}</div> : null}
    </div>
  );
}

/* ── EmptyState ─────────────────────────────────────────────────────────── */

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ title = 'Keine Einträge', description, icon, action, compact, ...rest }: EmptyStateProps) {
  return (
    <StateShell icon={icon ?? <Inbox size={compact ? 16 : 22} strokeWidth={1.5} />} tone="cyan" title={title} description={description} compact={compact} {...rest}>
      {action}
    </StateShell>
  );
}

/* ── ErrorState ─────────────────────────────────────────────────────────── */

export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: string;
  description?: ReactNode;
  /** Machine code, e.g. ADAPTER_TIMEOUT. */
  code?: string;
  correlationId?: string;
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  compact?: boolean;
  labels?: { copy?: string; copied?: string; correlation?: string };
}

export function ErrorState({
  title = 'Etwas ist schiefgelaufen',
  description,
  code,
  correlationId,
  onRetry,
  retrying,
  retryLabel = 'Erneut versuchen',
  compact,
  labels,
  ...rest
}: ErrorStateProps) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    if (!correlationId) return;
    try {
      await navigator.clipboard.writeText(correlationId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context / permissions): select-by-user remains possible via the visible ID.
      setCopied(false);
    }
  };
  return (
    <StateShell icon={<AlertOctagon size={compact ? 16 : 22} strokeWidth={1.5} />} tone="red" title={title} description={description} compact={compact} role="alert" {...rest}>
      {code || correlationId ? (
        <div className="jv-state__diag">
          {code ? <code className="jv-state__code">{code}</code> : null}
          {correlationId ? (
            <span className="jv-state__corr">
              <span>{labels?.correlation ?? 'Korrelations-ID'}</span>
              <code>{correlationId}</code>
              <button type="button" className="jv-state__copy" onClick={copy} aria-label={labels?.copy ?? 'Korrelations-ID kopieren'}>
                {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                <span aria-live="polite">{copied ? (labels?.copied ?? 'Kopiert') : (labels?.copy ?? 'Kopieren')}</span>
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      {onRetry ? (
        <Button size="sm" variant="primary" icon={<RefreshCw size={14} />} loading={retrying} onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </StateShell>
  );
}

/* ── OfflineState ───────────────────────────────────────────────────────── */

export interface OfflineStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: string;
  description?: ReactNode;
  /** ISO time of the last successful sync. */
  lastSync?: string;
  now?: Date;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
}

export function OfflineState({ title = 'Keine Verbindung', description = 'Der lokale Dienst ist nicht erreichbar. Es werden nur zwischengespeicherte Daten angezeigt.', lastSync, now, onRetry, retryLabel = 'Verbindung prüfen', compact, ...rest }: OfflineStateProps) {
  return (
    <StateShell icon={<WifiOff size={compact ? 16 : 22} strokeWidth={1.5} />} tone="blue" title={title} description={description} compact={compact} {...rest}>
      {lastSync ? <FreshnessBadge state="offline-cache" asOf={lastSync} now={now} /> : null}
      {onRetry ? (
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </StateShell>
  );
}

/* ── DegradedState ──────────────────────────────────────────────────────── */

export interface DegradedStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: string;
  description?: ReactNode;
  /** Affected components, listed as chips. */
  affected?: readonly string[];
  compact?: boolean;
  action?: ReactNode;
}

export function DegradedState({ title = 'Eingeschränkter Betrieb', description, affected, compact, action, ...rest }: DegradedStateProps) {
  return (
    <StateShell icon={<AlertTriangle size={compact ? 16 : 22} strokeWidth={1.5} />} tone="amber" title={title} description={description} compact={compact} {...rest}>
      {affected && affected.length > 0 ? (
        <ul className="jv-state__affected" aria-label="Betroffene Komponenten">
          {affected.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
      {action}
    </StateShell>
  );
}

/* ── StaleBanner ────────────────────────────────────────────────────────── */

export interface StaleBannerProps extends HTMLAttributes<HTMLDivElement> {
  asOf?: string;
  now?: Date;
  message?: string;
  onRefresh?: () => void;
  refreshLabel?: string;
  refreshing?: boolean;
}

export function StaleBanner({ asOf, now, message = 'Diese Daten sind möglicherweise nicht mehr aktuell.', onRefresh, refreshLabel = 'Aktualisieren', refreshing, className, ...rest }: StaleBannerProps) {
  return (
    <div className={cx('jv-stale', className)} role="status" {...rest}>
      <Clock3 size={14} strokeWidth={1.75} aria-hidden="true" />
      <span className="jv-stale__msg">{message}</span>
      <FreshnessBadge state="stale" asOf={asOf} now={now} />
      {onRefresh ? (
        <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={refreshing} onClick={onRefresh}>
          {refreshLabel}
        </Button>
      ) : null}
    </div>
  );
}
