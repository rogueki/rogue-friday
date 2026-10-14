import { LineBuilder, type PlateInstance, type SpriteInstance } from "./buffers";
import { DEG, Rand, cross3, fbm3, noise3, normalize3, planeBasis, smoothstep, type V3 } from "../rng";

/** Asymmetric density field: noise clusters + a bias towards the upper-left (the reference protrudes there). */
export function densityAt(dir: V3, seed: number, octaves: number): number {
  const n = fbm3(dir[0] * 1.9 + 3.1, dir[1] * 1.9 - 1.7, dir[2] * 1.9 + 0.4, octaves, seed);
  const bias = 0.5 + 0.4 * (-dir[0] * 0.8 + dir[1] * 0.3);
  return Math.min(1, Math.max(0, n * 1.25 * (0.55 + bias * 0.9)));
}

function sample(rand: Rand, seed: number, octaves: number, floor = 0.04): V3 {
  for (let i = 0; i < 40; i++) {
    const dir = rand.unitVector();
    if (rand.float() < Math.pow(densityAt(dir, seed, octaves), 1.6) + floor) return dir;
  }
  return rand.unitVector();
}

function toCartesian(lat: number, lon: number, r: number): V3 {
  const cl = Math.cos(lat);
  return [r * cl * Math.cos(lon), r * Math.sin(lat), r * cl * Math.sin(lon)];
}

export interface CircuitOptions {
  traces: number;
  seed: number;
  octaves: number;
  shells: readonly number[];
  shellWeights: readonly number[];
  /** Fraction of long straight "bus" traces. */
  busFraction: number;
  /** Maximum radial push-out probability for protruding fragments (outer shell). */
  pushProbability: number;
  pushRange: readonly [number, number];
  stepRange: readonly [number, number];
  /** Kind value baked into iMeta.y (shell brightness class). */
  kindBase: number;
}

export interface CircuitResult {
  lines: LineBuilder;
  nodes: SpriteInstance[];
  /** Number of segments, handy for tests/perf overlay. */
  segments: number;
}

/**
 * Manhattan circuit traces on nested spherical shells: random walks along latitude/longitude with 90-degree turns,
 * occasional vias (radius changes) and node squares at trace ends.
 */
export function buildCircuitTraces(opts: CircuitOptions): CircuitResult {
  const rand = new Rand(opts.seed);
  const lines = new LineBuilder();
  const nodes: SpriteInstance[] = [];

  for (let i = 0; i < opts.traces; i++) {
    const seed = rand.float();
    const dir = sample(rand, opts.seed, opts.octaves);
    let shellIdx = rand.weighted(opts.shellWeights);
    let radius = (opts.shells[shellIdx] as number) + rand.range(-0.025, 0.025);
    let push = 0;
    if (rand.chance(opts.pushProbability * (0.1 + 0.9 * smoothstep(0.25, -0.7, dir[0])))) {
      push = rand.range(opts.pushRange[0], opts.pushRange[1]);
      radius += push;
    }
    let lat = Math.asin(dir[1]);
    let lon = Math.atan2(dir[2], dir[0]);
    const isBus = rand.chance(opts.busFraction);
    const steps = isBus ? rand.int(5, 10) : rand.int(2, 8);
    let axis = rand.chance(0.5) ? 0 : 1; // 0: along latitude, 1: along longitude
    let sign = rand.sign();
    const pts: V3[] = [toCartesian(lat, lon, radius)];
    for (let s = 0; s < steps; s++) {
      const stepLen = rand.range(opts.stepRange[0], opts.stepRange[1]) * DEG * (isBus ? 1.8 : 1);
      if (axis === 1) lon += (sign * stepLen) / Math.max(Math.cos(lat), 0.22);
      else lat = Math.max(-1.4, Math.min(1.4, lat + sign * stepLen));
      pts.push(toCartesian(lat, lon, radius));
      const turn = isBus ? rand.chance(0.12) : rand.chance(0.66);
      if (turn) {
        axis = 1 - axis;
        sign = rand.sign();
        if (rand.chance(0.12)) {
          // via: hop to a neighbouring shell with a short radial segment
          shellIdx = rand.weighted(opts.shellWeights);
          const next = (opts.shells[shellIdx] as number) + rand.range(-0.02, 0.02) + push;
          pts.push(toCartesian(lat, lon, next));
          radius = next;
        }
      }
    }
    // `kind` carries the brightness of the cluster patch this trace sits in (noise field), so bright fragment patches emerge.
    const patch = smoothstep(0.46, 0.72, fbm3(dir[0] * 3.3 + 7.1, dir[1] * 3.3 - 2.3, dir[2] * 3.3 + 1.9, 2, opts.seed + 99));
    const kind = Math.min(1, patch * 0.85 + (isBus ? 0.1 : 0));
    lines.polyline(pts, seed, kind);
    const last = pts[pts.length - 1] as V3;
    if (rand.chance(0.8)) nodes.push({ pos: last, seed: rand.float(), size: rand.range(2.2, 4.6), shape: rand.int(0, 2) });
    if (rand.chance(0.35)) nodes.push({ pos: pts[0] as V3, seed: rand.float(), size: rand.range(1.8, 3.4), shape: rand.int(0, 2) });
  }
  return { lines, nodes, segments: lines.count };
}

export interface PlateOptions {
  count: number;
  seed: number;
  octaves: number;
  radii: readonly [number, number];
  sizeRange: readonly [number, number];
  streakFraction: number;
  pushProbability: number;
}

/** Chip plates tangent to the sphere, clustered by noise; ~10 % elongated vertical streaks. */
export function buildPlates(opts: PlateOptions): PlateInstance[] {
  const rand = new Rand(opts.seed);
  const plates: PlateInstance[] = [];
  for (let i = 0; i < opts.count; i++) {
    const dir = sample(rand, opts.seed + 5, opts.octaves, 0.04);
    let radius = rand.range(opts.radii[0], opts.radii[1]);
    if (rand.chance(opts.pushProbability * (0.1 + 0.9 * smoothstep(0.2, -0.7, dir[0])))) radius += rand.range(0.12, 0.42);
    const center: V3 = [dir[0] * radius, dir[1] * radius, dir[2] * radius];
    let [bu, bv] = planeBasis(dir);
    const streakNow = rand.chance(opts.streakFraction);
    if (streakNow) {
      // elongated streaks stand upright: height axis = world up projected onto the tangent plane
      const d = dir[1];
      const up: V3 = [-dir[0] * d, 1 - dir[1] * d, -dir[2] * d];
      const len = Math.hypot(up[0], up[1], up[2]);
      if (len > 0.25) {
        bv = [up[0] / len, up[1] / len, up[2] / len];
        bu = normalize3(cross3(bv, dir));
      }
    }
    const rot = streakNow ? rand.range(-0.06, 0.06) : rand.chance(0.7) ? (rand.int(0, 3) * Math.PI) / 2 + rand.range(-0.12, 0.12) : rand.range(0, Math.PI);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const u: V3 = [bu[0] * c + bv[0] * s, bu[1] * c + bv[1] * s, bu[2] * c + bv[2] * s];
    const v: V3 = [-bu[0] * s + bv[0] * c, -bu[1] * s + bv[1] * c, -bu[2] * s + bv[2] * c];
    const streak = streakNow;
    const base = rand.range(opts.sizeRange[0], opts.sizeRange[1]) * (rand.chance(0.12) ? 2.1 : 1);
    const aspect = streak ? rand.range(3.5, 7) : rand.range(0.7, 1.9);
    plates.push({
      center,
      u,
      v,
      width: streak ? base * 0.45 : base * Math.sqrt(aspect),
      height: streak ? base * aspect : base / Math.sqrt(aspect),
      seed: rand.float(),
      kind: streak ? 3 : rand.pick([0, 1, 2, 4] as const),
      bright: noise3(dir[0] * 3, dir[1] * 3, dir[2] * 3, opts.seed) * 0.7 + rand.float() * 0.3,
    });
  }
  return plates;
}
