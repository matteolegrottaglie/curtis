// ============================================================
//  Randomizzazione "umana"
//  Niente intervalli fissi: LinkedIn flagga i pattern regolari.
// ============================================================

/** Intero casuale inclusivo [min, max]. */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Float casuale [min, max). */
export function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/** Valore ± una percentuale (es. jitter(100, 0.2) -> 80..120). */
export function jitter(value: number, pct: number): number {
  const delta = value * pct;
  return value - delta + Math.random() * delta * 2;
}

/**
 * Distribuzione ~gaussiana troncata in [min, max].
 * Usata per i ritardi: la maggior parte dei valori sta al centro,
 * con code rare verso gli estremi — molto più umano dell'uniforme.
 */
export function gaussianClamped(min: number, max: number): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  let n = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  n = n / 6 + 0.5; // ~[0,1] centrata su 0.5 (3 deviazioni per lato)
  n = Math.max(0, Math.min(1, n));
  return min + n * (max - min);
}

/** Pesca un elemento a caso da un array (undefined se vuoto). */
export function pick<T>(arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** True con probabilità p (0..1). */
export function chance(p: number): boolean {
  return Math.random() < p;
}

/** Fisher-Yates: ritorna una copia mescolata. */
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
