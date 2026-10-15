import { useEffect, useRef, type CanvasHTMLAttributes } from 'react';
import { toneColors } from '@friday/design-tokens';
import { cx } from '../cx';
import { useMotionMode } from '../hooks';
import type { Tone } from '../types';

export type WaveformVariant = 'mirror' | 'bars' | 'line' | 'dots';

export interface WaveformProps extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, 'width' | 'height' | 'color'> {
  /** Fixed amplitudes 0..1. When given, nothing is generated and the canvas is static. */
  levels?: readonly number[];
  /** Animate a generated signal (ignored under reduced motion / off). */
  live?: boolean;
  /** 0..1 energy of the generated signal; 0 renders a flat idle trace. */
  energy?: number;
  variant?: WaveformVariant;
  /** Semantic tone (preferred) … */
  tone?: Tone;
  /** … or any CSS colour / `var(--token)`. */
  color?: string;
  /** CSS pixel height. */
  height?: number;
  /** CSS width (number = px, string = any CSS length). Default: fills the container. */
  width?: number | string;
  barWidth?: number;
  barGap?: number;
  /** Fade amplitude towards an edge, like the agent-card traces in the reference. */
  fade?: 'none' | 'edges' | 'left' | 'right';
  /** Seed for the deterministic static pattern. */
  seed?: number;
  /** Accessible description. Decorative when omitted. */
  label?: string;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Resolves `var(--x)` / tone to a concrete colour string usable by canvas. */
function resolveColor(el: HTMLElement, tone: Tone | undefined, color: string | undefined): string {
  const raw = color ?? `var(--friday-tone-${tone ?? 'cyan'})`;
  const match = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(raw.trim());
  if (!match) return raw;
  const value = getComputedStyle(el).getPropertyValue(match[1] as string).trim();
  if (value) return value;
  if (match[2]) return match[2];
  return tone ? toneColors[tone] : toneColors.cyan;
}

/** Environments without canvas (jsdom) throw or return null: the component then stays an empty, labelled box. */
function getContext2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

function edgeFactor(i: number, n: number, fade: WaveformProps['fade']): number {
  const p = n <= 1 ? 0.5 : i / (n - 1);
  switch (fade) {
    case 'edges':
      return Math.min(1, Math.sin(p * Math.PI) * 1.6);
    case 'left':
      return 0.15 + 0.85 * p;
    case 'right':
      return 0.15 + 0.85 * (1 - p);
    default:
      return 1;
  }
}

/** Fills `out` with amplitudes (0..1) for time `t` seconds. */
function generate(out: number[], t: number, energy: number, seed: number): void {
  const n = out.length;
  for (let i = 0; i < n; i += 1) {
    const phase = i * 0.55 + seed * 1.7;
    const wobble = Math.sin(t * 2.6 + phase) * 0.5 + Math.sin(t * 1.3 + phase * 0.37 + 1.2) * 0.5;
    const burst = 0.55 + 0.45 * Math.sin(t * 0.9 + i * 0.12 + seed);
    const v = 0.1 + energy * (0.35 + 0.65 * Math.abs(wobble)) * burst;
    out[i] = Math.min(1, Math.max(0.04, v));
  }
}

function staticLevels(count: number, energy: number, seed: number): number[] {
  const rnd = mulberry32(seed + 17);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const envelope = 0.55 + 0.45 * Math.sin((i / Math.max(1, count - 1)) * Math.PI * 3.2 + seed);
    out.push(Math.min(1, 0.08 + energy * (0.25 + 0.75 * rnd()) * envelope));
  }
  return out;
}

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  values: readonly number[],
  opts: { variant: WaveformVariant; color: string; barWidth: number; barGap: number; fade: WaveformProps['fade'] },
): void {
  const { variant, color, barWidth, barGap, fade } = opts;
  ctx.clearRect(0, 0, w, h);
  const n = values.length;
  if (n === 0) return;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  const mid = h / 2;

  if (variant === 'line') {
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
      const y = mid - (v - 0.5) * (h - 6) * edgeFactor(i, n, fade);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
    return;
  }

  if (variant === 'dots') {
    values.forEach((v, i) => {
      const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
      const y = mid - (v - 0.5) * (h - 6) * 0.9;
      ctx.globalAlpha = 0.35 + 0.65 * edgeFactor(i, n, fade);
      ctx.beginPath();
      ctx.arc(x, y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    return;
  }

  const step = barWidth + barGap;
  const total = Math.floor((w + barGap) / step);
  const count = Math.max(1, total);
  const offsetX = (w - (count * step - barGap)) / 2;
  for (let i = 0; i < count; i += 1) {
    const src = values[Math.min(n - 1, Math.floor((i / count) * n))] ?? 0;
    const amp = src * edgeFactor(i, count, fade);
    const bh = Math.max(1.5, amp * (h - 2));
    const x = offsetX + i * step;
    ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, amp * 1.4);
    if (variant === 'mirror') ctx.fillRect(x, mid - bh / 2, barWidth, bh);
    else ctx.fillRect(x, h - bh, barWidth, bh);
  }
  ctx.globalAlpha = 1;
}

/**
 * Canvas waveform. Draws static when `levels` is provided or motion is reduced; otherwise generates a
 * live signal at ≤30 fps and pauses when the tab is hidden or the canvas is scrolled out of view.
 */
export function Waveform({
  levels,
  live = false,
  energy = 0.7,
  variant = 'mirror',
  tone,
  color,
  height = 28,
  width,
  barWidth = 2,
  barGap = 2,
  fade = 'none',
  seed = 1,
  label,
  className,
  style,
  ...rest
}: WaveformProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { animate } = useMotionMode();
  const animated = live && animate && !levels;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = getContext2d(canvas);
    if (!ctx) return;

    let cssW = 0;
    let cssH = height;
    let raf = 0;
    let visible = true;
    let last = 0;
    const g = ctx;

    const count = (): number => Math.max(8, Math.floor((cssW + barGap) / (barWidth + barGap)));
    const buffer: number[] = [];

    const render = (t: number): void => {
      if (cssW <= 0) return;
      const resolved = resolveColor(canvas, tone, color);
      let values: readonly number[];
      if (levels) values = levels;
      else if (animated) {
        const n = variant === 'bars' || variant === 'mirror' ? count() : Math.max(16, Math.floor(cssW / 6));
        if (buffer.length !== n) buffer.length = n;
        generate(buffer, t, energy, seed);
        values = buffer;
      } else {
        const n = variant === 'bars' || variant === 'mirror' ? count() : Math.max(16, Math.floor(cssW / 6));
        values = staticLevels(n, energy, seed);
      }
      draw(g, cssW, cssH, values, { variant, color: resolved, barWidth, barGap, fade });
    };

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      cssW = Math.max(0, Math.round(rect.width));
      cssH = height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(performance.now() / 1000);
    };

    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      if (now - last < 33) return;
      last = now;
      render(now / 1000);
    };

    resize();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    ro?.observe(canvas);
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting);
          });
    io?.observe(canvas);
    if (animated) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
    };
  }, [levels, animated, energy, variant, tone, color, height, barWidth, barGap, fade, seed]);

  return (
    <canvas
      ref={ref}
      className={cx('jv-waveform', className)}
      style={{ width: width ?? '100%', height, ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    />
  );
}
