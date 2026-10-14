import { QUALITY_ORDER, type OrbQualityLevel } from "../settings";

export interface AdaptiveQualityOptions {
  /** Highest level auto may reach (auto never climbs to ultra by itself). */
  maxLevel: OrbQualityLevel;
  /** Downgrade when p95 frame time stays above this for `downgradeAfterSec`. */
  downgradeP95Ms: number;
  downgradeAfterSec: number;
  /** Upgrade only when p95 stays below this for `upgradeAfterSec` and the cooldown has passed. */
  upgradeP95Ms: number;
  upgradeAfterSec: number;
  cooldownSec: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveQualityOptions = {
  maxLevel: "high",
  downgradeP95Ms: 20,
  downgradeAfterSec: 3,
  upgradeP95Ms: 9,
  upgradeAfterSec: 12,
  cooldownSec: 8,
};

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] as number;
}

/**
 * Frame-time driven quality scaler. Feed it one sample per frame (milliseconds, wall clock);
 * it returns a new level only when a change is warranted.
 */
export class AdaptiveQuality {
  level: OrbQualityLevel;
  private samples: { t: number; ms: number }[] = [];
  private badSince: number | null = null;
  private goodSince: number | null = null;
  private lastChange = -Infinity;

  constructor(
    initial: OrbQualityLevel,
    private readonly opts: AdaptiveQualityOptions = DEFAULT_ADAPTIVE,
  ) {
    this.level = initial;
  }

  /** `now` in seconds (monotonic). Returns the new level if it changed, otherwise null. */
  push(ms: number, now: number): OrbQualityLevel | null {
    this.samples.push({ t: now, ms });
    const horizon = Math.max(this.opts.downgradeAfterSec, this.opts.upgradeAfterSec) + 1;
    while (this.samples.length > 0 && now - (this.samples[0] as { t: number }).t > horizon) this.samples.shift();

    const windowFor = (sec: number) => this.samples.filter((s) => now - s.t <= sec).map((s) => s.ms);
    const recent = windowFor(this.opts.downgradeAfterSec);
    const p95 = percentile(recent, 0.95);
    const spanned = this.samples.length > 0 && now - (this.samples[0] as { t: number }).t >= this.opts.downgradeAfterSec - 0.25;

    if (spanned && p95 > this.opts.downgradeP95Ms) {
      this.badSince ??= now;
      this.goodSince = null;
      if (now - this.badSince >= 0 && now - this.lastChange >= 1.5) return this.change(-1, now);
    } else {
      this.badSince = null;
      const longWindow = windowFor(this.opts.upgradeAfterSec);
      const longSpan = this.samples.length > 0 && now - (this.samples[0] as { t: number }).t >= this.opts.upgradeAfterSec - 0.25;
      if (longSpan && percentile(longWindow, 0.95) < this.opts.upgradeP95Ms) {
        this.goodSince ??= now;
        if (now - this.lastChange >= this.opts.cooldownSec) return this.change(1, now);
      } else {
        this.goodSince = null;
      }
    }
    return null;
  }

  private change(dir: -1 | 1, now: number): OrbQualityLevel | null {
    const idx = QUALITY_ORDER.indexOf(this.level);
    const max = QUALITY_ORDER.indexOf(this.opts.maxLevel);
    const next = Math.min(max, Math.max(0, idx + dir));
    this.samples = [];
    this.badSince = null;
    this.goodSince = null;
    this.lastChange = now;
    if (next === idx) return null;
    this.level = QUALITY_ORDER[next] as OrbQualityLevel;
    return this.level;
  }
}
