import type { LiveParams } from "../scene/liveParams";
import { breathScale } from "../scene/liveParams";
import { buildCircuitTraces, buildPlates } from "../scene/geometry/circuit";
import { DEG, Rand, smoothstep } from "../scene/rng";
import type { PlateInstance } from "../scene/geometry/buffers";
import { VISIBLE_RADIUS } from "../scene/fit";

/** Canvas-2D rendition of the orb: same palette, same circuit data, orthographic projection. */

const SEED = 20260615;
const TAU = Math.PI * 2;

interface FlatSegments {
  n: number;
  a: Float32Array;
  b: Float32Array;
  t: Float32Array;
  seed: Float32Array;
}

export interface Fallback2DData {
  mid: FlatSegments;
  outer: FlatSegments;
  plates: PlateInstance[];
  dashes: Record<string, [number, number][]>;
}

function flatten(raw: { a: number[]; b: number[]; t: number[]; meta: number[] }): FlatSegments {
  const n = raw.t.length / 2;
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) seed[i] = raw.meta[i * 2] as number;
  return { n, a: Float32Array.from(raw.a), b: Float32Array.from(raw.b), t: Float32Array.from(raw.t), seed };
}

function dashList(rand: Rand, segLen: [number, number], gapLen: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  let a = rand.range(0, 30) * DEG;
  while (a < TAU) {
    const e = Math.min(TAU, a + rand.range(segLen[0], segLen[1]) * DEG);
    out.push([a, e]);
    a = e + rand.range(gapLen[0], gapLen[1]) * DEG;
  }
  return out;
}

export function createFallbackData(): Fallback2DData {
  const mid = buildCircuitTraces({
    traces: 340, seed: SEED, octaves: 2, shells: [1.35, 1.5, 1.62], shellWeights: [0.3, 0.4, 0.3], busFraction: 0.12,
    pushProbability: 0, pushRange: [0, 0], stepRange: [2, 6], kindBase: 0.2,
  });
  const outer = buildCircuitTraces({
    traces: 120, seed: SEED + 41, octaves: 2, shells: [1.78, 1.95, 2.12], shellWeights: [0.35, 0.4, 0.25], busFraction: 0.2,
    pushProbability: 0.16, pushRange: [0.1, 0.32], stepRange: [2, 5], kindBase: 0.4,
  });
  const plates = buildPlates({ count: 70, seed: SEED + 11, octaves: 2, radii: [1.3, 2.2], sizeRange: [0.07, 0.24], streakFraction: 0.1, pushProbability: 0.2 });
  const rand = new Rand(SEED + 7);
  return {
    mid: flatten(mid.lines.raw()),
    outer: flatten(outer.lines.raw()),
    plates,
    dashes: {
      reactor0: dashList(rand, [14, 55], [4, 16]),
      reactor1: dashList(rand, [14, 55], [4, 16]),
      reactor2: dashList(rand, [14, 55], [4, 16]),
      gyroA: dashList(rand, [40, 110], [6, 22]),
      gyroB: dashList(rand, [40, 110], [6, 22]),
      primary: dashList(rand, [30, 95], [4, 14]),
      primary2: dashList(rand, [30, 95], [4, 14]),
      secondary: dashList(rand, [25, 80], [8, 28]),
    },
  };
}

function hash(p: number): number {
  p = (p * 0.1031) % 1;
  if (p < 0) p += 1;
  p *= p + 33.33;
  p *= p + p;
  return p - Math.floor(p);
}

type RGB3 = [number, number, number];
const ORANGE: RGB3 = [255, 138, 26];
const GOLD: RGB3 = [255, 181, 46];
const HOT: RGB3 = [255, 242, 186];
const CYAN: RGB3 = [26, 199, 255];

const mixRgb = (a: RGB3, b: RGB3, k: number): RGB3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

function saturate(c: RGB3, s: number): RGB3 {
  const l = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  const bronze: RGB3 = [l * 1.55, l * 1.0, l * 0.55];
  return mixRgb(bronze, c, s);
}

const css = (c: RGB3, a: number): string => `rgba(${Math.round(Math.min(255, c[0]))},${Math.round(Math.min(255, c[1]))},${Math.round(Math.min(255, c[2]))},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export interface Draw2DOptions {
  size: number;
  /** Fraction of the short side covered by the nominal visible orb (default 0.72). */
  fill: number;
}

class Projector {
  readonly cy: number;
  constructor(
    readonly cx: number,
    cy: number,
    readonly unit: number,
    private readonly ay: number,
    private readonly ax: number,
  ) {
    this.cy = cy;
    this.cosY = Math.cos(ay);
    this.sinY = Math.sin(ay);
    this.cosX = Math.cos(ax);
    this.sinX = Math.sin(ax);
  }
  private cosY: number;
  private sinY: number;
  private cosX: number;
  private sinX: number;
  out = { x: 0, y: 0, z: 0 };
  project(x: number, y: number, z: number): { x: number; y: number; z: number } {
    const x1 = x * this.cosY + z * this.sinY;
    const z1 = -x * this.sinY + z * this.cosY;
    const y2 = y * this.cosX - z1 * this.sinX;
    const z2 = y * this.sinX + z1 * this.cosX;
    const persp = 1 + z2 * 0.035;
    this.out.x = this.cx + x1 * this.unit * persp;
    this.out.y = this.cy - y2 * this.unit * persp;
    this.out.z = z2;
    return this.out;
  }
}

function depthFade(z: number): number {
  const d = Math.min(1, Math.max(0, 0.5 + 0.5 * (z / 2.3)));
  return 0.4 + 0.6 * smoothstep(0.05, 0.95, d);
}

function drawSegments(ctx: CanvasRenderingContext2D, seg: FlatSegments, p: Projector, live: LiveParams, base: number, revealStart: number, widthPx: number): void {
  const buckets: Map<string, number[]> = new Map();
  const flowPath: number[] = [];
  const edge = Math.max(0, Math.min(1, (live.reveal - revealStart) / Math.max(1 - revealStart, 1e-3))) * 3.6;
  for (let i = 0; i < seg.n; i++) {
    const s = seg.seed[i] as number;
    const h1 = hash(s * 13.37 + 1);
    const h2 = hash(s * 7.77 + 3);
    const h3 = hash(s * 5.13 + 9);
    const ax = seg.a[i * 3] as number, ay = seg.a[i * 3 + 1] as number, az = seg.a[i * 3 + 2] as number;
    const bx = seg.b[i * 3] as number, by = seg.b[i * 3 + 1] as number, bz = seg.b[i * 3 + 2] as number;
    const rmid = Math.hypot(ax + bx, ay + by, az + bz) * 0.5;
    const vis = live.reveal >= 0.999 ? 1 : edge <= 0 ? 0 : smoothstep(edge, edge - 0.6, rmid);
    if (vis < 0.02) continue;
    const bright = 0.32 + 0.68 * h3 * h3;
    const hot = h2 > 0.94 ? 1 : 0;
    const A = p.project(ax, ay, az);
    const x0 = A.x, y0 = A.y, z0 = A.z;
    const B = p.project(bx, by, bz);
    const fade = depthFade((z0 + B.z) * 0.5);
    const push = live.radialOffset * (0.25 + h1);
    const dx = push > 0 ? (ax / (rmid || 1)) * push * p.unit * 0.4 : 0;
    const dy = push > 0 ? -(ay / (rmid || 1)) * push * p.unit * 0.4 : 0;
    const head = (live.time * live.flowSpeed * (0.45 + h2 * 1.3) + h3 * 9) % 1;
    const behind = (((head - (seg.t[i * 2] as number)) % 1) + 1) % 1;
    const flow = h1 < live.packetRate && behind < 0.3 ? Math.pow(1 - behind / 0.3, 2.2) : 0;
    const alpha = Math.min(1, (bright * 1.0 + hot * 0.6) * base * fade * vis * live.emission);
    if (alpha < 0.02 && flow < 0.1) continue;
    const key = `${hot ? 2 : h2 < 0.5 ? 0 : 1}|${Math.round(alpha * 5)}`;
    let arr = buckets.get(key);
    if (!arr) buckets.set(key, (arr = []));
    arr.push(x0 + dx, y0 + dy, B.x + dx, B.y + dy);
    if (flow > 0.15) flowPath.push(x0 + dx, y0 + dy, B.x + dx, B.y + dy, Math.min(1, flow * fade * vis));
  }
  ctx.lineWidth = widthPx;
  ctx.lineCap = "round";
  for (const [key, pts] of buckets) {
    const [cls, aq] = key.split("|").map(Number) as [number, number];
    const col = saturate(cls === 2 ? HOT : cls === 1 ? GOLD : mixRgb(ORANGE, GOLD, 0.3), live.saturation);
    ctx.strokeStyle = css(col, (aq / 5) * 0.95);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 4) {
      ctx.moveTo(pts[i] as number, pts[i + 1] as number);
      ctx.lineTo(pts[i + 2] as number, pts[i + 3] as number);
    }
    ctx.stroke();
  }
  ctx.lineWidth = widthPx + 0.8;
  for (let i = 0; i < flowPath.length; i += 5) {
    ctx.strokeStyle = css(saturate(HOT, live.saturation), (flowPath[i + 4] as number) * 0.95);
    ctx.beginPath();
    ctx.moveTo(flowPath[i] as number, flowPath[i + 1] as number);
    ctx.lineTo(flowPath[i + 2] as number, flowPath[i + 3] as number);
    ctx.stroke();
  }
}

function strokeArc(
  ctx: CanvasRenderingContext2D,
  p: Projector,
  radius: number,
  a0: number,
  a1: number,
  tilt: number,
  rotZ: number,
  spin: number,
): number {
  const steps = Math.max(2, Math.ceil((a1 - a0) / (4 * DEG)));
  const ct = Math.cos(tilt), st = Math.sin(tilt), cz = Math.cos(rotZ), sz = Math.sin(rotZ);
  let zSum = 0;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps + spin;
    const x = Math.cos(a) * radius;
    const y0 = Math.sin(a) * radius;
    const y = y0 * ct;
    const z = y0 * st;
    const xr = x * cz - y * sz;
    const yr = x * sz + y * cz;
    const q = projectFlat(p, xr, yr);
    zSum += z;
    if (i === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();
  return zSum / (steps + 1);
}

function projectFlat(p: Projector, x: number, y: number): { x: number; y: number } {
  return { x: p.cx + x * p.unit, y: p.cy - y * p.unit };
}

function ring(
  ctx: CanvasRenderingContext2D,
  p: Projector,
  dashes: [number, number][],
  radius: number,
  tilt: number,
  rotZ: number,
  spin: number,
  alpha: number,
  width: number,
  color: RGB3,
  live: LiveParams,
): void {
  ctx.lineWidth = width;
  for (const [a0, a1] of dashes) {
    ctx.strokeStyle = css(saturate(color, live.saturation), alpha * live.emission);
    strokeArc(ctx, p, radius, a0, a1, tilt, rotZ, spin);
  }
}

export function drawOrb2D(ctx: CanvasRenderingContext2D, w: number, h: number, live: LiveParams, data: Fallback2DData, opts: Draw2DOptions): void {
  ctx.clearRect(0, 0, w, h);
  const unit = ((Math.min(w, h) * opts.fill) / (2 * VISIBLE_RADIUS)) * opts.size;
  const cx = w / 2;
  const cy = h / 2;
  const p = new Projector(cx, cy, unit, live.midAngle, 0.32);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const breath = breathScale(live);
  const calmK = 1 - live.calm;
  const E = live.emission;
  const sat = (c: RGB3) => saturate(c, live.saturation);

  // backdrop glow
  const g0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, unit * 2.3);
  g0.addColorStop(0, css(sat(GOLD), 0.14 * E * live.coreLevel));
  g0.addColorStop(0.5, css(sat(ORANGE), 0.04 * E));
  g0.addColorStop(1, css(sat(ORANGE), 0));
  ctx.fillStyle = g0;
  ctx.fillRect(0, 0, w, h);

  // circuit sphere + outer fragments
  // sphere limb: a faint outline gives the flat projection its silhouette
  ctx.strokeStyle = css(sat(ORANGE), 0.16 * E);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, unit * 1.62, 0, TAU);
  ctx.stroke();
  drawSegments(ctx, data.mid, p, live, 0.85, 0.12, 1.3);
  const po = new Projector(cx, cy, unit, -live.outerAngle, -0.18);
  drawSegments(ctx, data.outer, po, live, 0.8, 0.3, 1.3);

  // plates
  for (const pl of data.plates.slice(0, 44)) {
    const edge = Math.max(0, Math.min(1, (live.reveal - 0.2) / 0.8)) * 3.6;
    const rr = Math.hypot(...pl.center);
    if (rr > edge) continue;
    const q = p.project(pl.center[0], pl.center[1], pl.center[2]);
    const fade = depthFade(q.z);
    const wpx = Math.max(3, pl.width * unit * 0.9);
    const hpx = Math.max(3, pl.height * unit * 0.9);
    const a = Math.min(1, (0.14 + 0.4 * pl.bright) * fade * E);
    ctx.strokeStyle = css(sat(mixRgb(ORANGE, GOLD, hash(pl.seed * 9) )), a);
    ctx.lineWidth = 1;
    const vertical = Math.abs(pl.v[1]) > Math.abs(pl.u[1]);
    const rw = vertical ? wpx : hpx;
    const rh = vertical ? hpx : wpx;
    ctx.strokeRect(q.x - rw / 2, q.y - rh / 2, rw, rh);
    ctx.fillStyle = css(sat(GOLD), a * 0.12);
    ctx.fillRect(q.x - rw / 2, q.y - rh / 2, rw, rh);
    if (pl.kind === 0 || pl.kind === 2) {
      ctx.beginPath();
      const rows = 3;
      for (let i = 1; i <= rows; i++) {
        const yy = q.y - rh / 2 + (rh * i) / (rows + 1);
        ctx.moveTo(q.x - rw / 2 + 2, yy);
        ctx.lineTo(q.x - rw / 2 + 2 + (rw - 4) * (0.35 + 0.5 * hash(pl.seed * 3 + i)), yy);
      }
      ctx.stroke();
    }
  }

  // reactor rings
  const reactorR = [0.19, 0.3, 0.42];
  const keys = ["reactor0", "reactor1", "reactor2"];
  reactorR.forEach((r, i) => {
    ring(ctx, p, data.dashes[keys[i] as string] as [number, number][], r, 0.5 + i * 0.18, 0.3 * i, (i % 2 === 0 ? (live.ringAngles[0] as number) : (live.ringAngles[1] as number)), 0.95 - i * 0.1, 1.2, i === 0 ? HOT : GOLD, live);
  });
  // gyro rings
  ring(ctx, p, data.dashes.gyroA as [number, number][], 0.66, 0.9, 0.5, live.ringAngles[1] as number, 0.8, 1.3, GOLD, live);
  ring(ctx, p, data.dashes.gyroB as [number, number][], 0.78, 1.1, -0.6, (live.ringAngles[0] as number) * 0.9 + 1.3, 0.7, 1.3, GOLD, live);
  // primary / secondary
  const k = 1 - 0.72 * live.align;
  const flatPrimary = 1.18 * k;
  ring(ctx, p, data.dashes.primary as [number, number][], 1.94, flatPrimary, 0.2, live.ringAngles[2] as number, 0.7, 1.2, mixRgb(ORANGE, GOLD, 0.5), live);
  ring(ctx, p, data.dashes.primary2 as [number, number][], 2.0, flatPrimary, 0.2, (live.ringAngles[2] as number) * 1.05, 0.55, 1.1, GOLD, live);
  ring(ctx, p, data.dashes.secondary as [number, number][], 2.15, 62 * DEG * k + 0.1, 0.9, live.ringAngles[3] as number, 0.6, 1.1, mixRgb(ORANGE, GOLD, 0.35), live);

  // telemetry ring with health gaps
  {
    const tilt = 0.38 * (1 - 0.36 * live.align);
    const rot = -0.16;
    ctx.lineWidth = 1;
    for (let deg = 0; deg < 360; deg += 2) {
      const t = deg / 360;
      const gaps = [0.07, 0.31, 0.58, 0.83];
      const gd = Math.min(...gaps.map((g) => Math.abs(((t - g + 0.5) % 1 + 1) % 1 - 0.5)));
      if (gd < live.telemetryGap * 0.5) continue;
      const a = deg * DEG + (live.ringAngles[4] as number) + 0.2;
      const major = deg % 10 === 0;
      const r0 = 2.45;
      const r1 = r0 + (major ? 0.075 : 0.035);
      const pt = (r: number) => {
        const x = Math.cos(a) * r, y0 = Math.sin(a) * r;
        const y = y0 * Math.cos(tilt);
        const xr = x * Math.cos(rot) - y * Math.sin(rot);
        const yr = x * Math.sin(rot) + y * Math.cos(rot);
        return projectFlat(p, xr, yr);
      };
      const q0 = pt(r0), q1 = pt(r1);
      ctx.strokeStyle = css(sat(GOLD), (major ? 0.7 : 0.38) * E);
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.stroke();
    }
  }

  // energy arcs (core -> shell)
  if (live.energyArcs > 0.02) {
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      const rnd = new Rand(900 + i);
      const dir = rnd.unitVector();
      const bend = rnd.range(0.4, 1) * rnd.sign();
      const reach = rnd.range(1.5, 1.95);
      const headT = (live.time * (0.25 + rnd.float() * 0.35) + i * 0.17) % 1;
      ctx.strokeStyle = css(sat(HOT), 0.55 * live.energyArcs * E);
      ctx.beginPath();
      for (let s = 0; s <= 24; s++) {
        const t = s / 24;
        const behind = (((headT - t) % 1) + 1) % 1;
        if (behind > 0.45) continue;
        const r = 0.18 + (reach - 0.18) * t;
        const sw = Math.sin(t * Math.PI) * bend;
        const q = p.project(dir[0] * r + sw, dir[1] * r, dir[2] * r);
        if (s === 0 || behind > 0.44) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
    }
  }

  // core
  const coreA = Math.min(1.4, live.coreLevel) * E;
  const cr = unit * 0.85 * breath;
  const g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
  const white = Math.min(1, live.coreWhite + live.successPulse * 0.6);
  g1.addColorStop(0, css(sat(mixRgb(GOLD, [255, 250, 225], white)), Math.min(1, 0.95 * coreA)));
  g1.addColorStop(0.1, css(sat(mixRgb(GOLD, HOT, white)), 0.7 * coreA));
  g1.addColorStop(0.35, css(sat(GOLD), 0.22 * coreA));
  g1.addColorStop(1, css(sat(ORANGE), 0));
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.arc(cx, cy, cr, 0, TAU);
  ctx.fill();
  ctx.fillStyle = css(sat([255, 252, 232]), Math.min(1, coreA));
  ctx.beginPath();
  ctx.arc(cx, cy, unit * 0.1 * breath, 0, TAU);
  ctx.fill();

  // core energy noise: a few drifting soft blobs inside the core
  if (live.coreNoise > 0.02) {
    ctx.fillStyle = css(sat(HOT), 0.09 * live.coreNoise * E);
    for (let i = 0; i < 5; i++) {
      const a = live.time * (0.4 + i * 0.13) + i * 1.9;
      const rr = unit * (0.05 + 0.07 * ((i * 0.37) % 1));
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a * 1.2) * rr, unit * 0.075, 0, TAU);
      ctx.fill();
    }
  }

  // segmented ring: arcs pushed radially by the bands
  {
    const segs = 36;
    const bands = [live.inLow + live.outLow, live.inMid + live.outMid, live.inHigh + live.outHigh];
    ctx.lineWidth = 1.5;
    for (let i = 0; i < segs; i++) {
      const band = Math.min(1, bands[i % 3] as number);
      const push = (band * 0.22 + live.segDrive * 0.05) * (1 - 0.85 * live.align);
      const a0 = (i / segs) * TAU + (live.ringAngles[1] as number) * 0.6;
      const a1 = a0 + (TAU / segs) * 0.9;
      ctx.strokeStyle = css(sat(mixRgb(GOLD, HOT, band)), Math.min(1, 0.4 + band * 0.9) * E);
      ctx.beginPath();
      for (let k = 0; k <= 4; k++) {
        const a = a0 + ((a1 - a0) * k) / 4;
        const rr = (1.12 + push) * unit;
        const x = cx + Math.cos(a) * rr;
        const y = cy - Math.sin(a) * rr * 0.82;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // holographic shells: faint outlines with a rim
  if (live.shells > 0.02) {
    ctx.lineWidth = 1;
    for (const [rad, k] of [[1.28, 1], [1.82, 0.8]] as const) {
      ctx.strokeStyle = css(sat(mixRgb(ORANGE, GOLD, 0.6)), 0.2 * live.shells * k * E);
      ctx.beginPath();
      ctx.arc(cx, cy, unit * rad, 0, TAU);
      ctx.stroke();
    }
  }

  // voice reaction: input / output wave rings and radial pulse rings
  const waveRing = (open: number, level: number, low: number, mid: number, high: number, input: boolean) => {
    if (open < 0.02) return;
    const amp = (0.03 + 0.21 * level) * (1 - 0.45 * live.calm);
    const R0 = input ? 0.32 + (2.02 - 0.32) * open : 1.92 + 0.22 * level;
    const col = sat(input ? mixRgb(HOT, CYAN, 0.2) : mixRgb(GOLD, HOT, 0.55));
    ctx.lineWidth = 1.6 + level * 1.2;
    ctx.strokeStyle = css(col, Math.min(1, (0.25 + 1.4 * level) * open) * E);
    ctx.beginPath();
    const n = 120;
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * TAU;
      const wave = low * Math.sin(th * 3 + live.time * 1.4) + mid * 0.75 * Math.sin(th * 8 - live.time * 2.3 + 1.7) + high * 0.55 * Math.sin(th * 17 + live.time * 3.7 + 0.6);
      const rr = (R0 + wave * amp) * unit;
      const x = cx + Math.cos(th) * rr;
      const y = cy - Math.sin(th) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  waveRing(live.waveIn * Math.min(1, 0.05 + live.gainIn), live.inRms, live.inLow, live.inMid, live.inHigh, true);
  waveRing(live.waveOut * Math.min(1, 0.05 + live.gainOut), live.outRms, live.outLow, live.outMid, live.outHigh, false);
  for (let i = 0; i < live.radialAge.length; i++) {
    const age = live.radialAge[i] as number;
    if (age < 0) continue;
    const rr = 0.2 + (2.35 - 0.2) * (1 - (1 - age) * (1 - age));
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = css(sat(HOT), Math.pow(1 - age, 1.3) * (live.radialAmp[i] as number) * E);
    ctx.beginPath();
    ctx.arc(cx, cy, unit * rr, 0, TAU);
    ctx.stroke();
  }
  if (live.focus * live.approval > 0.02) {
    for (const off of [0, 0.5]) {
      const ph = (live.time * 0.3 + off) % 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = css([255, 160, 14], Math.pow(1 - ph, 1.2) * live.focus * live.approval * (off === 0 ? 0.8 : 0.4) * E);
      ctx.beginPath();
      ctx.arc(cx, cy, unit * (0.5 + 1.8 * ph), 0, TAU);
      ctx.stroke();
    }
  }
  if (live.warnPulse * live.warning > 0.02) {
    const ph = (live.time * 0.19 + 0.1) % 1;
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = css([255, 110, 14], Math.pow(1 - ph, 1.5) * live.warnPulse * live.warning * 0.6 * E);
    ctx.beginPath();
    ctx.arc(cx, cy, unit * (0.4 + 2.05 * ph), 0, TAU);
    ctx.stroke();
  }

  // radial scan wedge (transcribing), analysis sweep (thinking), sync sweep rings (syncing)
  if (live.radialScan > 0.02) {
    const head = -live.time * 1.5;
    const g = ctx.createConicGradient(head, cx, cy);
    g.addColorStop(0, css(mixRgb(GOLD, CYAN, 0.4), 0.55 * live.radialScan * E));
    g.addColorStop(0.0001, css(mixRgb(GOLD, CYAN, 0.4), 0));
    g.addColorStop(0.8, css(mixRgb(GOLD, CYAN, 0.4), 0));
    g.addColorStop(1, css(mixRgb(GOLD, CYAN, 0.4), 0.3 * live.radialScan * E));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, unit * 2.0, 0, TAU);
    ctx.fill();
  }
  if (live.analysisSweep > 0.02) {
    for (let k = 0; k < 3; k++) {
      const ph = (live.time * 0.27 + k / 3) % 1;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = css(sat(mixRgb(GOLD, [160, 110, 255], 0.28)), Math.sin(Math.PI * ph) * 0.8 * live.analysisSweep * E);
      ctx.setLineDash([unit * 0.5, unit * 0.2]);
      ctx.lineDashOffset = -live.time * unit * 0.4 * (k + 1);
      ctx.beginPath();
      ctx.arc(cx, cy, unit * (1.95 + (0.34 - 1.95) * Math.pow(ph, 1.15)), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if (live.syncSweep > 0.02) {
    for (const [rad, dir] of [[1.62, -0.9], [1.94, 0.7]] as const) {
      const a = live.time * dir;
      ctx.lineWidth = 2;
      ctx.strokeStyle = css(sat(mixRgb(GOLD, CYAN, 0.3)), 0.8 * live.syncSweep * E);
      ctx.beginPath();
      ctx.arc(cx, cy, unit * rad, a - 1.1, a, dir < 0);
      ctx.stroke();
      ctx.strokeStyle = css(sat(GOLD), 0.2 * live.syncSweep * E);
      ctx.beginPath();
      ctx.arc(cx, cy, unit * rad, 0, TAU);
      ctx.stroke();
    }
  }

  // energy particles: pushed out by the audio force, streaming in while transcribing
  {
    const n = 48;
    const force = live.particleForce * live.particleDrive;
    for (let i = 0; i < n; i++) {
      const r0 = hash(i * 3.1 + 1) * 1.6 + 0.9;
      const ang = hash(i * 7.3 + 2) * TAU + live.time * 0.04 * (hash(i + 5) - 0.3);
      const cyc = (live.time * (0.07 + 0.09 * hash(i + 9)) + hash(i + 11)) % 1;
      let rr = r0 + force * (0.18 + 0.5 * hash(i + 3)) + live.peakKick * 0.3 * calmK;
      rr = rr + (0.24 - rr) * live.particleInward * Math.pow(cyc, 1.6);
      const act = Math.max(0.22, Math.max(force * 1.2, live.particleInward));
      ctx.fillStyle = css(sat(hash(i + 13) > 0.82 ? HOT : GOLD), (0.3 + 0.7 * hash(i + 17)) * act * E);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * rr * unit, cy - Math.sin(ang) * rr * unit, 1.1 + 1.4 * hash(i + 19), 0, TAU);
      ctx.fill();
    }
  }

  // progress orbit
  if (live.progressVisible > 0.02 && live.progressMode > 0) {
    const r = 2.64;
    const tilt = 0.34;
    ctx.lineWidth = 2;
    const steps = 160;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      let lit: number;
      if (live.progressMode < 1.5) lit = t0 <= live.progress ? 0.85 : 0;
      else lit = (() => {
        const behind = ((((live.time * 0.32) % 1) - t0) % 1 + 1) % 1;
        return behind < 0.34 ? Math.pow(1 - behind / 0.34, 1.6) : 0;
      })();
      const a0 = Math.PI / 2 - t0 * TAU, a1 = Math.PI / 2 - t1 * TAU;
      const pt = (a: number) => projectFlat(p, Math.cos(a) * r, Math.sin(a) * r * Math.cos(tilt));
      const q0 = pt(a0), q1 = pt(a1);
      ctx.strokeStyle = css(sat(lit > 0.5 ? HOT : GOLD), (0.14 + 0.86 * lit) * live.progressVisible * E);
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.stroke();
    }
  }

  // overlays
  if (live.approval > 0.02) {
    const pulse = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(live.time * 1.5));
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = css([255, 176, 10], live.approval * pulse * E);
    for (let i = 0; i < 6; i++) strokeArc(ctx, p, 2.32, (i / 6) * TAU + 6 * DEG, ((i + 1) / 6) * TAU - 6 * DEG, 0.3, 0.4, 0);
  }
  if (live.approval > 0.02) {
    // approval glyph: shield with an exclamation mark above the core
    const gx = cx;
    const gy = cy - unit * 0.72;
    const gs = unit * 0.2;
    const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(live.time * 1.25 - 0.8));
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = css([255, 178, 20], live.approval * pulse * E);
    ctx.fillStyle = css([255, 178, 20], live.approval * pulse * E);
    ctx.beginPath();
    ctx.moveTo(gx, gy - gs * 0.92);
    ctx.lineTo(gx + gs * 0.78, gy - gs * 0.58);
    ctx.lineTo(gx + gs * 0.78, gy + gs * 0.12);
    ctx.lineTo(gx, gy + gs * 0.95);
    ctx.lineTo(gx - gs * 0.78, gy + gs * 0.12);
    ctx.lineTo(gx - gs * 0.78, gy - gs * 0.58);
    ctx.closePath();
    ctx.stroke();
    ctx.fillRect(gx - gs * 0.07, gy - gs * 0.5, gs * 0.14, gs * 0.62);
    ctx.beginPath();
    ctx.arc(gx, gy + gs * 0.4, gs * 0.085, 0, TAU);
    ctx.fill();
  }
  if (live.warning > 0.02) {
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = css([255, 120, 20], live.warning * 0.85 * E);
    strokeArc(ctx, p, 2.54, 20 * DEG, 320 * DEG, 0.12, 0.3, 0);
  }
  if (live.error > 0.02) {
    const rnd = new Rand(23);
    ctx.lineWidth = 1.7;
    let a = 0;
    const fr = live.fracture + live.errorImpulse * 0.9;
    while (a < 360) {
      const len = rnd.range(14, 44);
      const gap = rnd.range(3, 14);
      const dr = (rnd.float() - 0.35) * 0.3 * fr;
      const da = (rnd.float() - 0.5) * 0.26 * fr;
      ctx.strokeStyle = css([255, 52, 22], live.error * 0.9 * E);
      strokeArc(ctx, p, 2.22 + dr, a * DEG + da, Math.min(360, a + len) * DEG + da, 0.2, 0.55, 0);
      a += len + gap;
    }
  }

  // agent markers
  const agents = Math.min(8, Math.round(live.agentCount));
  for (let i = 0; i < agents; i++) {
    const rnd = new Rand(1337 + i);
    const theta = (i / 8) * TAU + live.time * 0.2;
    const q = p.project(Math.cos(theta) * 2.3, Math.sin(theta) * 2.3 * Math.cos(0.9 + rnd.float() * 0.5), Math.sin(theta) * 2.3 * Math.sin(0.9));
    ctx.fillStyle = css(sat(HOT), 0.9 * depthFade(q.z));
    ctx.beginPath();
    ctx.moveTo(q.x, q.y - 5);
    ctx.lineTo(q.x + 4, q.y);
    ctx.lineTo(q.x, q.y + 5);
    ctx.lineTo(q.x - 4, q.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
