import { LineBuilder, pointsGeometry, type PointCloud } from "./buffers";
import { DEG, Rand, cross3, normalize3, planeBasis, type V3 } from "../rng";
import { BufferAttribute, type BufferGeometry, type InstancedBufferGeometry } from "three";

const TAU = Math.PI * 2;

function circlePoint(u: V3, v: V3, r: number, a: number, offset: V3 = [0, 0, 0]): V3 {
  const c = Math.cos(a) * r;
  const s = Math.sin(a) * r;
  return [u[0] * c + v[0] * s + offset[0], u[1] * c + v[1] * s + offset[1], u[2] * c + v[2] * s + offset[2]];
}

/** A flat ring in the XY plane (normal +Z), `t` = angle / 2pi. Optionally dashed with seeded gaps. */
function ringLines(
  lines: LineBuilder,
  rand: Rand,
  radius: number,
  opts: { dashed?: boolean; segLen?: [number, number]; gapLen?: [number, number]; kind?: number; step?: number; arcStart?: number; arcEnd?: number },
): void {
  const step = (opts.step ?? 3) * DEG;
  const u: V3 = [1, 0, 0];
  const v: V3 = [0, 1, 0];
  const start = (opts.arcStart ?? 0) * DEG;
  const end = (opts.arcEnd ?? 360) * DEG;
  let a = start;
  while (a < end - 1e-4) {
    let segEnd = end;
    let gap = 0;
    if (opts.dashed) {
      segEnd = Math.min(end, a + rand.range(opts.segLen?.[0] ?? 18, opts.segLen?.[1] ?? 60) * DEG);
      gap = rand.range(opts.gapLen?.[0] ?? 3, opts.gapLen?.[1] ?? 12) * DEG;
    }
    const n = Math.max(1, Math.ceil((segEnd - a) / step));
    const pts: V3[] = [];
    for (let i = 0; i <= n; i++) pts.push(circlePoint(u, v, radius, a + ((segEnd - a) * i) / n));
    lines.polyline(pts, rand.float(), opts.kind ?? 0.3, a / TAU, segEnd / TAU);
    a = segEnd + gap;
    if (!opts.dashed) break;
  }
}

export interface BuiltLines {
  geometry: InstancedBufferGeometry;
  segments: number;
}

const finish = (lines: LineBuilder): BuiltLines => ({ geometry: lines.build(), segments: lines.count });

/** Inner reactor: mini rings from dashed segments, tick marks and radial spokes. Several independently rotating sub-groups. */
export function buildInnerReactor(seed: number): { rings: BuiltLines[]; spokes: BuiltLines } {
  const rand = new Rand(seed);
  const rings: BuiltLines[] = [];
  const radii = [0.19, 0.3, 0.42, 0.55];
  radii.forEach((r, idx) => {
    const lines = new LineBuilder();
    ringLines(lines, rand, r, { dashed: idx !== 0, segLen: [14, 55], gapLen: [4, 16], kind: 0.9 - idx * 0.1, step: 4 });
    if (idx === 0) ringLines(lines, rand, r * 0.62, { kind: 0.95, step: 6 });
    // short tick marks around the ring
    const ticks = 18 + idx * 8;
    for (let i = 0; i < ticks; i++) {
      if (rand.chance(0.35)) continue;
      const a = (i / ticks) * TAU + rand.range(-0.03, 0.03);
      const len = rand.range(0.02, 0.055);
      lines.segment([Math.cos(a) * (r - len), Math.sin(a) * (r - len), 0], [Math.cos(a) * (r + len), Math.sin(a) * (r + len), 0], a / TAU, a / TAU, rand.float(), 0.7);
    }
    rings.push(finish(lines));
  });
  const spokes = new LineBuilder();
  const n = 40;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand.range(-0.04, 0.04);
    const r0 = rand.range(0.12, 0.28);
    const r1 = r0 + rand.range(0.06, 0.34);
    spokes.segment([Math.cos(a) * r0, Math.sin(a) * r0, 0], [Math.cos(a) * r1, Math.sin(a) * r1, 0], r0 / 0.6, r1 / 0.6, rand.float(), 0.65);
  }
  return { rings, spokes: finish(spokes) };
}

/** Two tilted gyro rings, r 0.66 / 0.78, double lined with long dashes. */
export function buildGyroRings(seed: number): BuiltLines[] {
  const rand = new Rand(seed);
  return [0.66, 0.78].map((r, i) => {
    const lines = new LineBuilder();
    ringLines(lines, rand, r, { dashed: true, segLen: [40, 110], gapLen: [6, 22], kind: 0.75, step: 4 });
    ringLines(lines, rand, r + 0.028 + i * 0.01, { dashed: true, segLen: [12, 50], gapLen: [10, 40], kind: 0.6, step: 4 });
    return finish(lines);
  });
}

/** Primary orbital ring: band of 3 concentric lines at r ~1.95 with segment gaps. */
export function buildPrimaryRing(seed: number): BuiltLines {
  const rand = new Rand(seed);
  const lines = new LineBuilder();
  [1.92, 1.96, 2.0].forEach((r, i) => {
    ringLines(lines, rand, r, { dashed: true, segLen: [30, 95], gapLen: [4, 14], kind: 0.55 + i * 0.12, step: 3 });
  });
  // sparse longer outer hairline
  ringLines(lines, rand, 2.06, { dashed: true, segLen: [10, 40], gapLen: [30, 80], kind: 0.4, step: 4 });
  return finish(lines);
}

/** Secondary tilted ring r ~2.15, segmented. */
export function buildSecondaryRing(seed: number): BuiltLines {
  const rand = new Rand(seed);
  const lines = new LineBuilder();
  ringLines(lines, rand, 2.15, { dashed: true, segLen: [25, 80], gapLen: [8, 28], kind: 0.65, step: 3 });
  ringLines(lines, rand, 2.185, { dashed: true, segLen: [6, 22], gapLen: [14, 40], kind: 0.5, step: 3 });
  return finish(lines);
}

/** Telemetry ring r ~2.45: fine tick marks, longer ticks every 10 degrees; gaps are cut in the shader (health). */
export function buildTelemetryRing(seed: number): BuiltLines {
  const rand = new Rand(seed);
  const lines = new LineBuilder();
  const r = 2.45;
  for (let deg = 0; deg < 360; deg += 2) {
    const a = deg * DEG;
    const major = deg % 10 === 0;
    const len = major ? 0.075 : 0.035;
    lines.segment(
      [Math.cos(a) * r, Math.sin(a) * r, 0],
      [Math.cos(a) * (r + len), Math.sin(a) * (r + len), 0],
      a / TAU,
      a / TAU,
      rand.float(),
      major ? 0.8 : 0.45,
    );
  }
  ringLines(lines, rand, r, { kind: 0.5, step: 3 });
  return finish(lines);
}

/** Progress orbit r ~2.62. t = angle / 2pi measured clockwise from 12 o'clock; the shader decides what is lit. */
export function buildProgressOrbit(): BuiltLines {
  const lines = new LineBuilder();
  const r = 2.64;
  const n = 220;
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = Math.PI / 2 - t * TAU;
    pts.push([Math.cos(a) * r, Math.sin(a) * r, 0]);
  }
  lines.polyline(pts, 0.5, 1, 0, 1);
  // small tick every 10 percent
  for (let i = 0; i < 10; i++) {
    const t = i / 10;
    const a = Math.PI / 2 - t * TAU;
    lines.segment([Math.cos(a) * (r - 0.05), Math.sin(a) * (r - 0.05), 0], [Math.cos(a) * (r + 0.05), Math.sin(a) * (r + 0.05), 0], t, t, 0.2, 1);
  }
  return finish(lines);
}

export interface ArcOptions {
  count: number;
  seed: number;
  radii: readonly [number, number];
  length: readonly [number, number];
  lineCount: readonly [number, number];
  pushProbability: number;
  pushRange: readonly [number, number];
  tickProbability: number;
  kind: number;
  /** Probability of a camera-facing plane normal: the arc then hugs the silhouette instead of crossing the face. */
  facing?: number;
}

/**
 * Partial arcs on tilted planes through the orb. `great` mode (long thin arcs) and fragment mode (outer shell) share
 * the same builder: 1-4 parallel lines, optional tick marks and radial push-out.
 */
export function buildArcs(opts: ArcOptions): BuiltLines {
  const rand = new Rand(opts.seed);
  const lines = new LineBuilder();
  for (let i = 0; i < opts.count; i++) {
    const n = rand.unitVector();
    // bias normals so fragments cluster around the equator band and the left side
    if (rand.chance(0.35)) n[0] -= 0.6;
    if (rand.chance(opts.facing ?? 0)) {
      n[0] = rand.range(-0.55, 0.55);
      n[1] = rand.range(-0.55, 0.55);
      n[2] = rand.sign() * rand.range(0.75, 1);
    }
    const [u, v] = planeBasis(normalize3(n));
    let radius = rand.range(opts.radii[0], opts.radii[1]);
    if (rand.chance(opts.pushProbability)) radius += rand.range(opts.pushRange[0], opts.pushRange[1]);
    const len = rand.range(opts.length[0], opts.length[1]) * DEG;
    const start = rand.range(0, TAU);
    const parallel = rand.int(opts.lineCount[0], opts.lineCount[1]);
    const gap = rand.range(0.012, 0.034);
    const seed = rand.float();
    const nn = normalize3(n);
    const steps = Math.max(2, Math.ceil(len / (3 * DEG)));
    for (let k = 0; k < parallel; k++) {
      const off = (k - (parallel - 1) / 2) * gap;
      const pts: V3[] = [];
      const rk = Math.sqrt(Math.max(0.01, radius * radius - off * off));
      for (let s = 0; s <= steps; s++) pts.push(circlePoint(u, v, rk, start + (len * s) / steps, [nn[0] * off, nn[1] * off, nn[2] * off]));
      lines.polyline(pts, seed + k * 0.013, opts.kind + k * 0.05);
    }
    if (rand.chance(opts.tickProbability)) {
      const tickStep = rand.range(3, 6) * DEG;
      for (let a = 0; a <= len; a += tickStep) {
        const tl = rand.chance(0.25) ? 0.07 : 0.035;
        const p0 = circlePoint(u, v, radius, start + a);
        const p1 = circlePoint(u, v, radius + tl, start + a);
        lines.segment(p0, p1, a / len, a / len, seed + 0.5, opts.kind);
      }
    }
  }
  return finish(lines);
}

/** Core-to-shell energy arcs: 4-8 bent curves. t = 0 at the core, 1 at the shell. */
export function buildEnergyArcs(count: number, seed: number): BuiltLines {
  const rand = new Rand(seed);
  const lines = new LineBuilder();
  for (let i = 0; i < count; i++) {
    const dir = rand.unitVector();
    const side = normalize3(cross3(dir, [0, 1, 0.3]));
    const bend = rand.range(0.4, 1.0) * rand.sign();
    const r0 = 0.18;
    const r1 = rand.range(1.5, 1.95);
    const pts: V3[] = [];
    const n = 28;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const r = r0 + (r1 - r0) * t;
      const swirl = Math.sin(t * Math.PI) * bend;
      pts.push([dir[0] * r + side[0] * swirl, dir[1] * r + side[1] * swirl, dir[2] * r + side[2] * swirl]);
    }
    lines.polyline(pts, rand.float(), 0.9);
  }
  return finish(lines);
}

/** Radial bars of the audio halo. t = angle/2pi; the vertex shader scales each bar by the audio level. */
export function buildHaloBars(count: number): BuiltLines {
  const lines = new LineBuilder();
  const r = 2.8;
  const rand = new Rand(41);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    lines.segment([Math.cos(a) * r, Math.sin(a) * r, 0], [Math.cos(a) * (r + 0.42), Math.sin(a) * (r + 0.42), 0], a / TAU, a / TAU, rand.float(), 0.8);
  }
  // thin inner baseline
  ringLines(lines, rand, r - 0.025, { kind: 0.25, step: 3 });
  return finish(lines);
}

/** Approval overlay: six open ring segments with double lines at r ~2.32. */
export function buildApprovalRing(): BuiltLines {
  const lines = new LineBuilder();
  const rand = new Rand(7);
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * 360 + 6;
    const a1 = ((i + 1) / segs) * 360 - 6;
    ringLines(lines, rand, 2.32, { kind: 0.9, step: 2.5, arcStart: a0, arcEnd: a1 });
    ringLines(lines, rand, 2.35, { kind: 0.6, step: 2.5, arcStart: a0 + 6, arcEnd: a1 - 6 });
  }
  return finish(lines);
}

/** Warning overlay: one deliberately incomplete outer ring (300 degrees) with end caps. */
export function buildWarningRing(): BuiltLines {
  const lines = new LineBuilder();
  const rand = new Rand(11);
  ringLines(lines, rand, 2.54, { kind: 0.9, step: 2.5, arcStart: 20, arcEnd: 320 });
  ringLines(lines, rand, 2.575, { kind: 0.6, step: 2.5, arcStart: 60, arcEnd: 290, dashed: true, segLen: [10, 30], gapLen: [4, 10] });
  for (const deg of [20, 320]) {
    const a = deg * DEG;
    lines.segment([Math.cos(a) * 2.48, Math.sin(a) * 2.48, 0], [Math.cos(a) * 2.64, Math.sin(a) * 2.64, 0], deg / 360, deg / 360, 0.3, 1);
  }
  return finish(lines);
}

/** Error fracture overlay: ring split in irregular segments; the shader displaces them by `uFracture`. */
export function buildFractureRing(): BuiltLines {
  const lines = new LineBuilder();
  const rand = new Rand(23);
  let a = 0;
  while (a < 360) {
    const len = rand.range(14, 44);
    const gap = rand.range(3, 14);
    const end = Math.min(360, a + len);
    const r = 2.22 + rand.range(-0.02, 0.02);
    ringLines(lines, rand, r, { kind: 1, step: 2.5, arcStart: a, arcEnd: end });
    if (rand.chance(0.5)) ringLines(lines, rand, r + 0.035, { kind: 0.7, step: 2.5, arcStart: a + 3, arcEnd: Math.max(a + 4, end - 5) });
    a = end + gap;
  }
  // short crack lines across the ring
  for (let i = 0; i < 9; i++) {
    const ang = rand.range(0, TAU);
    const r0 = 2.1 + rand.range(0, 0.1);
    const r1 = r0 + rand.range(0.12, 0.28);
    const j = rand.range(-0.06, 0.06);
    lines.segment([Math.cos(ang) * r0, Math.sin(ang) * r0, 0], [Math.cos(ang + j) * r1, Math.sin(ang + j) * r1, 0], 0, 1, rand.float(), 1);
  }
  return finish(lines);
}

/** Iris/lens structure around the core: ring + smaller offset circle, dashed inner ring, crossing arcs and fine spokes. */
export function buildCoreLens(seed: number): BuiltLines {
  const rand = new Rand(seed);
  const lines = new LineBuilder();
  const circle = (cx: number, cy: number, r: number, kind: number, a0 = 0, a1 = 360) => {
    const n = Math.max(8, Math.ceil((a1 - a0) / 6));
    const pts: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (a0 + ((a1 - a0) * i) / n) * DEG;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0]);
    }
    lines.polyline(pts, rand.float(), kind, a0 / 360, a1 / 360);
  };
  circle(0, 0, 0.16, 0.95);
  circle(0.05, -0.028, 0.078, 1);
  circle(-0.02, 0.012, 0.05, 0.9, 20, 300);
  ringLines(lines, rand, 0.115, { dashed: true, segLen: [18, 46], gapLen: [14, 30], kind: 0.8, step: 5 });
  ringLines(lines, rand, 0.215, { dashed: true, segLen: [30, 80], gapLen: [20, 50], kind: 0.6, step: 5 });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU + rand.range(-0.05, 0.05);
    const r0 = 0.085 + rand.range(0, 0.03);
    const r1 = r0 + rand.range(0.03, 0.09);
    lines.segment([Math.cos(a) * r0, Math.sin(a) * r0, 0], [Math.cos(a) * r1, Math.sin(a) * r1, 0], r0, r1, rand.float(), 0.9);
  }
  return finish(lines);
}

/** Unit ring in the XZ plane, scaled by the ScanPlane component. */
export function buildScanRing(): BuiltLines {
  const lines = new LineBuilder();
  const n = 96;
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    pts.push([Math.cos(a), 0, Math.sin(a)]);
  }
  lines.polyline(pts, 0.5, 1, 0, 1);
  return finish(lines);
}

/** Fine micro-particle halo around the orb (shell radius 1.3..3.1). */
export function buildParticles(count: number, seed: number): PointCloud {
  const rand = new Rand(seed);
  const positions = new Float32Array(count * 3);
  const info = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const d = rand.unitVector();
    const r = 1.25 + Math.pow(rand.float(), 1.7) * 1.9;
    positions.set([d[0] * r, d[1] * r, d[2] * r], i * 3);
    info.set([rand.float(), rand.range(1.2, 2.8), rand.float(), rand.float()], i * 4);
  }
  return { positions, info, count };
}

/** Larger, fainter depth dust spread through a wide volume (parallax cue). */
export function buildDust(count: number, seed: number): PointCloud {
  const rand = new Rand(seed);
  const positions = new Float32Array(count * 3);
  const info = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const d = rand.unitVector();
    const r = rand.range(2.2, 5.2);
    positions.set([d[0] * r * 1.25, d[1] * r * 0.85, d[2] * r], i * 3);
    info.set([rand.float(), rand.range(2.5, 6), rand.float(), rand.float()], i * 4);
  }
  return { positions, info, count };
}

export interface PacketPoints {
  geometry: BufferGeometry;
  count: number;
}

export const PACKET_TAIL = 6;

/**
 * Data packets travelling on orbital lanes. Every packet is `PACKET_TAIL` points with decreasing alpha.
 * aOrbit = phase, inclination, node, speed ; aInfo = seed, tail index, radius, gate
 */
export function buildPackets(count: number, seed: number): PacketPoints {
  const rand = new Rand(seed);
  const total = count * PACKET_TAIL;
  const positions = new Float32Array(total * 3);
  const orbit = new Float32Array(total * 4);
  const info = new Float32Array(total * 4);
  for (let i = 0; i < count; i++) {
    const phase = rand.range(0, TAU);
    const inc = rand.range(0.1, Math.PI - 0.1);
    const node = rand.range(0, TAU);
    const speed = rand.range(0.5, 1.4) * rand.sign();
    const radius = rand.range(1.3, 2.35);
    const pseed = rand.float();
    const gate = (i + 0.5) / count;
    for (let k = 0; k < PACKET_TAIL; k++) {
      const idx = i * PACKET_TAIL + k;
      orbit.set([phase, inc, node, speed], idx * 4);
      info.set([pseed, k / (PACKET_TAIL - 1), radius, gate], idx * 4);
    }
  }
  const g = pointsGeometry({ positions, info, count: total });
  g.setAttribute("aOrbit", new BufferAttribute(orbit, 4));
  return { geometry: g, count: total };
}

export interface MarkerGeometry {
  geometry: BufferGeometry;
  count: number;
}

/** Agent markers: small diamonds orbiting r ~2.3. aOrbit = phase, inclination, node, speed; aInfo = seed, index, radius, 0 */
export function buildAgentMarkers(max: number): MarkerGeometry {
  const positions = new Float32Array(max * 3);
  const orbit = new Float32Array(max * 4);
  const info = new Float32Array(max * 4);
  const rand = new Rand(1337);
  for (let i = 0; i < max; i++) {
    orbit.set([(i / max) * TAU + rand.range(-0.2, 0.2), rand.range(0.9, 1.9), rand.range(0, TAU), 0.18 + rand.range(0, 0.12)], i * 4);
    info.set([rand.float(), i, 2.3 + rand.range(-0.06, 0.06), 0], i * 4);
  }
  const g = pointsGeometry({ positions, info, count: max });
  g.setAttribute("aOrbit", new BufferAttribute(orbit, 4));
  return { geometry: g, count: max };
}
