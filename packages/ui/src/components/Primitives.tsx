import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Clock3,
  CloudOff,
  Database,
  Loader2,
  Wrench,
  XOctagon,
} from 'lucide-react';
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../cx';
import { healthTone, type FreshnessState, type HealthState, type Tone } from '../types';

/* ── VisuallyHidden ─────────────────────────────────────────────────────── */

export function VisuallyHidden({ children, as: As = 'span', ...rest }: HTMLAttributes<HTMLElement> & { as?: 'span' | 'div' | 'h2' | 'label' }) {
  return (
    <As className="jv-sr-only" {...rest}>
      {children}
    </As>
  );
}

/* ── StatusDot ──────────────────────────────────────────────────────────── */

export function StatusDot({ tone = 'green', pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span aria-hidden="true" className={cx('jv-dot', `jv-tone-${tone}`, pulse && 'jv-dot--pulse', className)} />;
}

/* ── IconTile ───────────────────────────────────────────────────────────── */

export interface IconTileProps extends HTMLAttributes<HTMLSpanElement> {
  icon: ReactNode;
  tone?: Tone;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** active = brighter border + soft glow */
  active?: boolean;
}

/** Square tinted tile with a line icon — the signature element of list rows and cards. */
export const IconTile = forwardRef<HTMLSpanElement, IconTileProps>(function IconTile(
  { icon, tone = 'cyan', size = 'md', active = false, className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cx('jv-icon-tile', `jv-icon-tile--${size}`, `jv-tone-${tone}`, active && 'jv-icon-tile--active', className)}
      {...rest}
    >
      {icon}
    </span>
  );
});

/* ── TagPill ────────────────────────────────────────────────────────────── */

export interface TagPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** solid = filled for emphasis */
  solid?: boolean;
  icon?: ReactNode;
}

/** 10 px uppercase mono tag: INFO, WARN, TIP, LIVE… */
export function TagPill({ tone = 'cyan', solid = false, icon, className, children, ...rest }: TagPillProps) {
  return (
    <span className={cx('jv-tag', `jv-tone-${tone}`, solid && 'jv-tag--solid', className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}

/* ── Badge (counts) ─────────────────────────────────────────────────────── */

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  count: number;
  max?: number;
  tone?: Tone;
  /** Screen-reader label, e.g. "3 offene Aufgaben". */
  label?: string;
  showZero?: boolean;
}

export function Badge({ count, max = 99, tone = 'cyan', label, showZero = false, className, ...rest }: BadgeProps) {
  if (count <= 0 && !showZero) return null;
  const text = count > max ? `${max}+` : String(count);
  return (
    <span className={cx('jv-badge', `jv-tone-${tone}`, className)} {...rest}>
      <span aria-hidden="true">{text}</span>
      <span className="jv-sr-only">{label ?? count}</span>
    </span>
  );
}

/* ── StatusChip ─────────────────────────────────────────────────────────── */

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** leading status dot (default) or custom icon */
  icon?: ReactNode;
  dot?: boolean;
  pulse?: boolean;
}

export function StatusChip({ tone = 'cyan', icon, dot = true, pulse = false, className, children, ...rest }: StatusChipProps) {
  return (
    <span className={cx('jv-chip', `jv-tone-${tone}`, className)} {...rest}>
      {icon ? <span className="jv-chip__icon">{icon}</span> : dot ? <StatusDot tone={tone} pulse={pulse} /> : null}
      <span className="jv-chip__label">{children}</span>
    </span>
  );
}

/* ── StatusFlag ─────────────────────────────────────────────────────────── */

export interface StatusFlagProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'aria-label'> {
  icon: ReactNode;
  /** What is flagged, e.g. "Wake-Word". */
  label: string;
  /** Current state in words, e.g. "bereit". */
  value: string;
  tone?: 'ok' | 'warn' | 'off';
  /** Reachable by keyboard so the (tooltip) text can be read; default true. */
  focusable?: boolean;
}

/**
 * Icon-only status marker. The text alternative is visually hidden text rather than `aria-label` on a role-less
 * `<span>` (axe: aria-prohibited-attr); the icon itself is decorative.
 */
export function StatusFlag({ icon, label, value, tone = 'off', focusable = true, className, ...rest }: StatusFlagProps) {
  return (
    <span className={cx('jv-flag', tone !== 'off' && `jv-flag--${tone}`, className)} tabIndex={focusable ? 0 : undefined} {...rest}>
      <span aria-hidden="true" className="jv-flag__icon">
        {icon}
      </span>
      <span className="jv-sr-only">
        {label}: {value}
      </span>
    </span>
  );
}

/* ── HealthBadge ────────────────────────────────────────────────────────── */

const healthIcon: Record<HealthState, ReactNode> = {
  ok: <CheckCircle2 size={13} strokeWidth={1.75} aria-hidden="true" />,
  degraded: <AlertTriangle size={13} strokeWidth={1.75} aria-hidden="true" />,
  down: <XOctagon size={13} strokeWidth={1.75} aria-hidden="true" />,
  unknown: <CircleHelp size={13} strokeWidth={1.75} aria-hidden="true" />,
  maintenance: <Wrench size={13} strokeWidth={1.75} aria-hidden="true" />,
};

export const defaultHealthLabels: Record<HealthState, string> = {
  ok: 'Betriebsbereit',
  degraded: 'Eingeschränkt',
  down: 'Ausgefallen',
  unknown: 'Unbekannt',
  maintenance: 'Wartung',
};

export interface HealthBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  state: HealthState;
  labels?: Partial<Record<HealthState, string>>;
  /** Hide the text (icon-only), still announced to screen readers. */
  compact?: boolean;
}

/** State is conveyed by icon + text, never colour alone. */
export function HealthBadge({ state, labels, compact = false, className, ...rest }: HealthBadgeProps) {
  const text = labels?.[state] ?? defaultHealthLabels[state];
  return (
    <span className={cx('jv-health', `jv-tone-${healthTone[state]}`, className)} data-state={state} {...rest}>
      {healthIcon[state]}
      {compact ? <span className="jv-sr-only">{text}</span> : <span>{text}</span>}
    </span>
  );
}

/* ── FreshnessBadge ─────────────────────────────────────────────────────── */

export const defaultFreshnessLabels: Record<FreshnessState, string> = {
  fresh: 'Aktuell',
  stale: 'Veraltet',
  unknown: 'Unbekannt',
  'offline-cache': 'Offline-Cache',
};

const freshnessIcon: Record<FreshnessState, ReactNode> = {
  fresh: <CheckCircle2 size={12} strokeWidth={1.75} aria-hidden="true" />,
  stale: <Clock3 size={12} strokeWidth={1.75} aria-hidden="true" />,
  unknown: <CircleHelp size={12} strokeWidth={1.75} aria-hidden="true" />,
  'offline-cache': <CloudOff size={12} strokeWidth={1.75} aria-hidden="true" />,
};

const freshnessTone: Record<FreshnessState, Tone> = {
  fresh: 'green',
  stale: 'amber',
  unknown: 'muted',
  'offline-cache': 'blue',
};

export interface FreshnessBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  state: FreshnessState;
  /** ISO timestamp of the data (`freshness.asOf`). */
  asOf?: string;
  /** Reference time for the relative label (default: Date.now()). */
  now?: Date;
  locale?: string;
  labels?: Partial<Record<FreshnessState, string>>;
}

function formatRelative(asOf: string, now: Date, locale: string): string | null {
  const then = new Date(asOf).getTime();
  if (Number.isNaN(then)) return null;
  const diffSec = Math.round((then - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 45) return rtf.format(diffSec, 'second');
  if (abs < 2700) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 64800) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}

/** Distinct icon + text per state; the timestamp is added as relative time. */
export function FreshnessBadge({ state, asOf, now, locale = 'de-DE', labels, className, ...rest }: FreshnessBadgeProps) {
  const label = labels?.[state] ?? defaultFreshnessLabels[state];
  const relative = asOf ? formatRelative(asOf, now ?? new Date(), locale) : null;
  return (
    <span
      className={cx('jv-fresh', `jv-tone-${freshnessTone[state]}`, className)}
      data-state={state}
      title={asOf ? `${label} · ${asOf}` : label}
      {...rest}
    >
      {freshnessIcon[state]}
      <span>{label}</span>
      {relative ? <span className="jv-fresh__time">· {relative}</span> : null}
    </span>
  );
}

/* ── SourceBadge ────────────────────────────────────────────────────────── */

export interface SourceBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Source system, e.g. "Hermes". */
  source: string;
  /** Data origin mode. */
  mode?: 'live' | 'cache';
  prefix?: string;
  modeLabels?: Partial<Record<'live' | 'cache', string>>;
}

const defaultModeLabels = { live: 'Live', cache: 'Cache' } as const;

export function SourceBadge({ source, mode, prefix = 'Quelle', modeLabels, className, ...rest }: SourceBadgeProps) {
  const modeText = mode ? (modeLabels?.[mode] ?? defaultModeLabels[mode]) : null;
  return (
    <span className={cx('jv-source', mode && `jv-source--${mode}`, className)} {...rest}>
      <Database size={11} strokeWidth={1.75} aria-hidden="true" />
      <span className="jv-source__prefix">{prefix}:</span>
      <span className="jv-source__name">{source}</span>
      {modeText ? <span className="jv-source__mode">{modeText}</span> : null}
    </span>
  );
}

/* ── Button / IconButton ────────────────────────────────────────────────── */

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'friday' | 'subtle';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, loading = false, block = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('jv-btn', `jv-btn--${variant}`, `jv-btn--${size}`, block && 'jv-btn--block', loading && 'jv-btn--loading', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="jv-spin" size={14} strokeWidth={1.75} aria-hidden="true" /> : icon}
      {children ? <span className="jv-btn__label">{children}</span> : null}
      {iconRight}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required accessible name. */
  label: string;
  icon: ReactNode;
  variant?: 'ghost' | 'primary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Count/dot badge overlay (e.g. notifications). */
  badge?: ReactNode;
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', badge, pressed, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx('jv-iconbtn', `jv-iconbtn--${variant}`, `jv-iconbtn--${size}`, className)}
      {...rest}
    >
      {icon}
      {badge ? <span className="jv-iconbtn__badge">{badge}</span> : null}
    </button>
  );
});

/* ── Skeleton ───────────────────────────────────────────────────────────── */

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: number | string;
  height?: number | string;
  /** Number of text-like lines (overrides height). */
  lines?: number;
  variant?: 'block' | 'line' | 'circle' | 'row';
  /** Accessible label for the loading region. */
  label?: string;
}

/** HUD shimmer placeholder. Static under reduced motion (CSS). */
export function Skeleton({ width, height, lines, variant = 'block', label = 'Wird geladen …', className, style, ...rest }: SkeletonProps) {
  if (lines && lines > 0) {
    return (
      <div role="status" aria-busy="true" aria-label={label} className={cx('jv-skeleton-stack', className)} style={style} {...rest}>
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className="jv-skeleton jv-skeleton--line"
            style={{ width: i === lines - 1 && lines > 1 ? '62%' : width }}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cx('jv-skeleton', `jv-skeleton--${variant}`, className)}
      style={{ width, height, ...style }}
      {...rest}
    />
  );
}

