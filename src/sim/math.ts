/** Numerically defensive math helpers shared by every simulation layer. */

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

export const clampFinite = (value: number, min: number, max: number, fallback = min): number =>
  clamp(finite(value, fallback), min, max);

export const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

export const lerp = (from: number, to: number, alpha: number): number =>
  from + (to - from) * clampFinite(alpha, 0, 1, 0);

/** First-order lag that is stable for arbitrarily large or negative dt. */
export const approach = (current: number, target: number, dtSec: number, tauSec: number): number => {
  const safeCurrent = finite(current, target);
  const safeTarget = finite(target, safeCurrent);
  const alpha = 1 - Math.exp(-Math.max(0, finite(dtSec)) / Math.max(1, finite(tauSec, 1)));
  return safeCurrent + (safeTarget - safeCurrent) * clamp(alpha, 0, 1);
};

/** Deterministic Mulberry32 PRNG for reproducible simulation runs. */
export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }
}
