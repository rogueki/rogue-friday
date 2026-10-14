import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { forwardRef, useId, useMemo, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../cx';
import { useMotionMode } from '../hooks';
import type { Tone } from '../types';
import { IconTile, Skeleton } from './Primitives';
import { Tooltip } from './Tooltip';
import { Waveform } from './Waveform';

/* ── CircularMetric ─────────────────────────────────────────────────────── */

export interface CircularMetricProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** 0..100. `null`/`undefined` = value unavailable: renders "—", never a fake 0. */
  value: number | null | undefined;
  label: string;
  unit?: string;
  size?: number;
  strokeWidth?: number;
  tone?: Tone;
  /** Tone override above thresholds: [warnAt, critAt] (percent). */
  thresholds?: readonly [number, number];
  /** Why the value is missing (tooltip + screen reader). */
  nullReason?: string;
  /** Value text formatter, default rounds to integer. */
  format?: (value: number) => string;
  /** Secondary line under the value (e.g. "12.4 / 16 GB"). */
  caption?: string;
}

export const CircularMetric = forwardRef<HTMLDivElement, CircularMetricProps>(function CircularMetric(
  {
    value,
    label,
    unit = '%',
    size = 84,
    strokeWidth = 6,
    tone = 'cyan',
    thresholds,
    nullReason = 'Wert nicht verfügbar',
    format,
    caption,
    className,
    ...rest
  },
  ref,
) {
  const missing = value === null || value === undefined || Number.isNaN(value);
  const clamped = missing ? 0 : Math.min(100, Math.max(0, value));
  const effectiveTone: Tone = (() => {
    if (missing || !thresholds) return tone;
    if (clamped >= thresholds[1]) return 'red';
    if (clamped >= thresholds[0]) return 'amber';
    return tone;
  })();
  const r = (size - strokeWidth) / 2 - 3;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped / 100);
  const text = missing ? '—' : `${format ? format(clamped) : Math.round(clamped)}`;
  const accessible = missing ? `${label}: nicht verfügbar. ${nullReason}` : `${label}: ${text}${unit}${caption ? `, ${caption}` : ''}`;

  const gauge = (
    <div
      ref={ref}
      role="img"
      aria-label={accessible}
      className={cx('jv-circular', `jv-tone-${effectiveTone}`, missing && 'jv-circular--missing', className)}
      style={{ width: size, height: size }}
      data-missing={missing || undefined}
      {...rest}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r + strokeWidth / 2 + 2} className="jv-circular__outer" />
        <circle cx={size / 2} cy={size / 2} r={r} className="jv-circular__track" strokeWidth={strokeWidth} />
        {missing ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            className="jv-circular__unknown"
            strokeWidth={strokeWidth}
            strokeDasharray="2 7"
          />
        ) : (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            className="jv-circular__arc"
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div className="jv-circular__center" aria-hidden="true">
        <span className="jv-circular__label">{label}</span>
        <span className="jv-circular__value">
          {text}
          {missing ? null : <span className="jv-circular__unit">{unit}</span>}
        </span>
        {caption && !missing ? <span className="jv-circular__caption">{caption}</span> : null}
      </div>
    </div>
  );

  return missing ? <Tooltip content={nullReason}>{gauge}</Tooltip> : gauge;
});

/* ── MetricCard ─────────────────────────────────────────────────────────── */

export interface MetricCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: string;
  /** `null` = unavailable, rendered as "—" with reason. */
  value: ReactNode | null;
  unit?: string;
  icon?: ReactNode;
  tone?: Tone;
  /** Change vs. reference, e.g. "+4 heute". */
  delta?: string;
  trend?: 'up' | 'down' | 'flat';
  /** Whether "up" is good (green) or bad (red). */
  trendGood?: 'up' | 'down';
  hint?: string;
  nullReason?: string;
  loading?: boolean;
  spark?: readonly number[];
}

export const MetricCard = forwardRef<HTMLDivElement, MetricCardProps>(function MetricCard(
  { label, value, unit, icon, tone = 'cyan', delta, trend, trendGood = 'up', hint, nullReason = 'Wert nicht verfügbar', loading, spark, className, ...rest },
  ref,
) {
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : ArrowRight;
  const trendTone: Tone = !trend || trend === 'flat' ? 'muted' : trend === trendGood ? 'green' : 'red';
  return (
    <div ref={ref} className={cx('jv-metric', `jv-tone-${tone}`, className)} aria-busy={loading || undefined} {...rest}>
      <div className="jv-metric__head">
        {icon ? <IconTile icon={icon} tone={tone} size="sm" /> : null}
        <span className="jv-metric__label">{label}</span>
      </div>
      {loading ? (
        <Skeleton height={28} width="55%" label={`${label} wird geladen`} />
      ) : value === null ? (
        <Tooltip content={nullReason}>
          <span className="jv-metric__value jv-metric__value--missing" aria-label={`${label}: nicht verfügbar. ${nullReason}`} tabIndex={0}>
            —
          </span>
        </Tooltip>
      ) : (
        <div className="jv-metric__value">
          {value}
          {unit ? <span className="jv-metric__unit">{unit}</span> : null}
        </div>
      )}
      {(delta || hint) && !loading ? (
        <div className="jv-metric__foot">
          {delta ? (
            <span className={cx('jv-metric__delta', `jv-tone-${trendTone}`)}>
              {trend ? <TrendIcon size={12} strokeWidth={1.75} aria-hidden="true" /> : null}
              {delta}
            </span>
          ) : null}
          {hint ? <span className="jv-metric__hint">{hint}</span> : null}
        </div>
      ) : null}
      {spark && !loading ? <Waveform levels={spark} variant="line" tone={tone} height={26} className="jv-metric__spark" /> : null}
    </div>
  );
});

/* ── ConstellationGraph ─────────────────────────────────────────────────── */

export interface GraphNode {
  id: string;
  /** 0..1 normalised position; generated deterministically when omitted */
  x?: number;
  y?: number;
  /** 0..1 importance → radius */
  weight?: number;
  label?: string;
  tone?: Tone;
}

export interface ConstellationGraphProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  nodes?: readonly GraphNode[];
  edges?: readonly (readonly [string, string])[];
  /** Used when `nodes` is omitted: deterministic demo constellation of this size. */
  seed?: number;
  count?: number;
  width?: number;
  height?: number;
  tone?: Tone;
  /** Required for assistive tech: what the graph shows. */
  summary: string;
}

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateGraph(seed: number, count: number): { nodes: GraphNode[]; edges: [string, string][] } {
  const rnd = prng(seed);
  const nodes: GraphNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = 0.06 + (i / Math.max(1, count - 1)) * 0.88 + (rnd() - 0.5) * 0.06;
    const y = 0.18 + rnd() * 0.64;
    nodes.push({ id: `n${i}`, x: Math.min(0.96, Math.max(0.04, x)), y, weight: 0.25 + rnd() * 0.75 });
  }
  const edges: [string, string][] = [];
  for (let i = 1; i < count; i += 1) {
    edges.push([`n${i - 1}`, `n${i}`]);
    if (i > 2 && rnd() > 0.55) edges.push([`n${i - 2 - Math.floor(rnd() * 2)}`, `n${i}`]);
  }
  return { nodes, edges };
}

/** Small SVG constellation for Memory Insights. Text alternative via `summary`. */
export function ConstellationGraph({
  nodes,
  edges,
  seed = 7,
  count = 15,
  width = 320,
  height = 140,
  tone = 'cyan',
  summary,
  className,
  ...rest
}: ConstellationGraphProps) {
  const { animate } = useMotionMode();
  const titleId = useId();
  const graph = useMemo(() => (nodes ? { nodes: [...nodes], edges: [...(edges ?? [])] } : generateGraph(seed, count)), [nodes, edges, seed, count]);
  const byId = useMemo(() => new Map(graph.nodes.map((n, i) => [n.id, { ...n, x: n.x ?? ((i * 0.37) % 0.9) + 0.05, y: n.y ?? ((i * 0.53) % 0.7) + 0.15 }])), [graph.nodes]);

  return (
    <div className={cx('jv-constellation', `jv-tone-${tone}`, className)} {...rest}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet">
        <title id={titleId}>{summary}</title>
        <g className="jv-constellation__edges">
          {graph.edges.map(([a, b]) => {
            const na = byId.get(a);
            const nb = byId.get(b);
            if (!na || !nb) return null;
            return <line key={`${a}-${b}`} x1={na.x * width} y1={na.y * height} x2={nb.x * width} y2={nb.y * height} />;
          })}
        </g>
        <g className="jv-constellation__nodes">
          {[...byId.values()].map((n, i) => (
            <circle
              key={n.id}
              cx={n.x * width}
              cy={n.y * height}
              r={2.2 + (n.weight ?? 0.5) * 2.8}
              className={cx(animate && 'jv-twinkle', n.tone && `jv-tone-${n.tone}`)}
              style={animate ? { animationDelay: `${(i % 7) * 0.4}s` } : undefined}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
