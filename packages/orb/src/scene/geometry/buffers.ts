import { BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedBufferGeometry } from "three";
import type { V3 } from "../rng";

/**
 * Screen-space line segments rendered as instanced quads. One instance = one segment:
 *   iA, iB   endpoints (orb space)
 *   iT       arc-length parameter at A and B (0..1 along the trace, or angle/2pi for rings)
 *   iMeta    seed, kind
 * The shared quad provides (side, end) corners in `position.xy`.
 * Compared with GL_LINES this gives controllable, DPR-independent stroke width and anti-aliasing.
 */
export class LineBuilder {
  private a: number[] = [];
  private b: number[] = [];
  private t: number[] = [];
  private meta: number[] = [];

  get count(): number {
    return this.t.length / 2;
  }

  /** Raw segment data (used by the Canvas-2D fallback to project the same circuit without three.js). */
  raw(): { a: number[]; b: number[]; t: number[]; meta: number[] } {
    return { a: this.a, b: this.b, t: this.t, meta: this.meta };
  }

  segment(p: V3, q: V3, tA: number, tB: number, seed: number, kind = 0): void {
    this.a.push(p[0], p[1], p[2]);
    this.b.push(q[0], q[1], q[2]);
    this.t.push(tA, tB);
    this.meta.push(seed, kind);
  }

  /** Polyline with `t` ramping from t0 to t1 by cumulative length. */
  polyline(points: V3[], seed: number, kind = 0, t0 = 0, t1 = 1): void {
    if (points.length < 2) return;
    const lens: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1] as V3;
      const q = points[i] as V3;
      lens.push((lens[i - 1] as number) + Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
    }
    const total = lens[lens.length - 1] || 1;
    for (let i = 1; i < points.length; i++) {
      this.segment(
        points[i - 1] as V3,
        points[i] as V3,
        t0 + ((t1 - t0) * (lens[i - 1] as number)) / total,
        t0 + ((t1 - t0) * (lens[i] as number)) / total,
        seed,
        kind,
      );
    }
  }

  build(): InstancedBufferGeometry {
    const g = createQuadGeometry();
    const n = this.count;
    g.setAttribute("iA", new InstancedBufferAttribute(new Float32Array(this.a), 3));
    g.setAttribute("iB", new InstancedBufferAttribute(new Float32Array(this.b), 3));
    g.setAttribute("iT", new InstancedBufferAttribute(new Float32Array(this.t), 2));
    g.setAttribute("iMeta", new InstancedBufferAttribute(new Float32Array(this.meta), 2));
    g.instanceCount = n;
    return g;
  }
}

/** Corner quad shared by all instanced primitives: position.xy = (side -1|1, end 0|1). */
function createQuadGeometry(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  const corners = new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]);
  g.setAttribute("position", new BufferAttribute(corners, 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
}

export interface PlateInstance {
  center: V3;
  u: V3;
  v: V3;
  width: number;
  height: number;
  seed: number;
  kind: number;
  bright: number;
}

/** Instanced plates (chip graphics); the quad spans -0.5..0.5 in its own plane. */
export function buildPlateGeometry(plates: PlateInstance[]): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  const n = plates.length;
  const c = new Float32Array(n * 3);
  const u = new Float32Array(n * 3);
  const v = new Float32Array(n * 3);
  const size = new Float32Array(n * 2);
  const meta = new Float32Array(n * 3);
  plates.forEach((p, i) => {
    c.set(p.center, i * 3);
    u.set(p.u, i * 3);
    v.set(p.v, i * 3);
    size.set([p.width, p.height], i * 2);
    meta.set([p.seed, p.kind, p.bright], i * 3);
  });
  g.setAttribute("iCenter", new InstancedBufferAttribute(c, 3));
  g.setAttribute("iU", new InstancedBufferAttribute(u, 3));
  g.setAttribute("iV", new InstancedBufferAttribute(v, 3));
  g.setAttribute("iSize", new InstancedBufferAttribute(size, 2));
  g.setAttribute("iMeta", new InstancedBufferAttribute(meta, 3));
  g.instanceCount = n;
  return g;
}

export interface SpriteInstance {
  pos: V3;
  seed: number;
  /** Size in CSS pixels. */
  size: number;
  shape: number;
  extra?: number;
}

/** Screen-space sprites (nodes, markers). `iInfo` = seed, sizePx, shape, extra. */
export function buildSpriteGeometry(sprites: SpriteInstance[]): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  const n = sprites.length;
  const pos = new Float32Array(n * 3);
  const info = new Float32Array(n * 4);
  sprites.forEach((s, i) => {
    pos.set(s.pos, i * 3);
    info.set([s.seed, s.size, s.shape, s.extra ?? 0], i * 4);
  });
  g.setAttribute("iPos", new InstancedBufferAttribute(pos, 3));
  g.setAttribute("iInfo", new InstancedBufferAttribute(info, 4));
  g.instanceCount = n;
  return g;
}

export interface PointCloud {
  positions: Float32Array;
  /** seed, sizePx, twinkle, extra */
  info: Float32Array;
  count: number;
}

export function pointsGeometry(cloud: PointCloud): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(cloud.positions, 3));
  g.setAttribute("aInfo", new BufferAttribute(cloud.info, 4));
  return g;
}
