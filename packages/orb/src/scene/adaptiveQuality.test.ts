import { describe, expect, it } from "vitest";
import { AdaptiveQuality, percentile } from "./adaptiveQuality";

function run(q: AdaptiveQuality, ms: number, seconds: number, start: number, fps = 60): { level: string | null; end: number } {
  let changed: string | null = null;
  let t = start;
  const dt = 1 / fps;
  while (t < start + seconds) {
    const r = q.push(ms, t);
    if (r) changed = r;
    t += dt;
  }
  return { level: changed, end: t };
}

describe("AdaptiveQuality", () => {
  it("computes percentiles", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([], 0.95)).toBe(0);
  });

  it("downgrades when p95 exceeds 20 ms for 3 s", () => {
    const q = new AdaptiveQuality("high");
    const r = run(q, 30, 4, 0, 30);
    expect(r.level).toBe("medium");
    expect(q.level).toBe("medium");
  });

  it("does not downgrade on a short hitch", () => {
    const q = new AdaptiveQuality("high");
    let t = 0;
    for (let i = 0; i < 300; i++, t += 1 / 60) q.push(i % 100 === 0 ? 40 : 8, t);
    expect(q.level).toBe("high");
  });

  it("keeps stepping down while the system stays slow and stops at low", () => {
    const q = new AdaptiveQuality("high");
    run(q, 40, 20, 0, 30);
    expect(q.level).toBe("low");
  });

  it("upgrades carefully after a long calm period but never above the max level", () => {
    const q = new AdaptiveQuality("low");
    const r = run(q, 6, 40, 0, 60);
    expect(r.level).not.toBeNull();
    expect(["medium", "high"]).toContain(q.level);
    run(q, 6, 120, r.end, 60);
    expect(q.level).toBe("high");
  });
});
