// ============================================================
//  "Human" randomization
//  No fixed intervals: LinkedIn flags regular patterns.
// ============================================================

/** Inclusive random integer in [min, max]. */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random float in [min, max). */
export function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/** Value ± a percentage (e.g. jitter(100, 0.2) -> 80..120). */
export function jitter(value: number, pct: number): number {
  const delta = value * pct;
  return value - delta + Math.random() * delta * 2;
}

/**
 * Roughly Gaussian distribution clamped to [min, max].
 * Used for delays: most values land in the middle, with rare tails
 * towards the extremes — far more human than a uniform draw.
 */
export function gaussianClamped(min: number, max: number): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  let n = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  n = n / 6 + 0.5; // ~[0,1] centred on 0.5 (3 deviations per side)
  n = Math.max(0, Math.min(1, n));
  return min + n * (max - min);
}

/** Draws a random element from an array (undefined if empty). */
export function pick<T>(arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** True with probability p (0..1). */
export function chance(p: number): boolean {
  return Math.random() < p;
}

/** Fisher-Yates: returns a shuffled copy. */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}
