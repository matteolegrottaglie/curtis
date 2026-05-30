// ============================================================
//  Helper di tempo / fuso orario (basato su luxon)
//  La finestra "orari lavorativi" è il primo strato anti-ban:
//  niente attività notturna o 24/7.
// ============================================================
import { DateTime } from 'luxon';
import type { SafetyConfig } from '../types.js';

export function nowMs(): number {
  return Date.now();
}

/** Data ISO (YYYY-MM-DD) nel fuso configurato. */
export function isoDate(tz: string, at: number = Date.now()): string {
  return DateTime.fromMillis(at).setZone(tz).toISODate() ?? '';
}

/** È adesso dentro la finestra "giorni + orari lavorativi"? */
export function inWorkingWindow(cfg: SafetyConfig, at: number = Date.now()): boolean {
  const dt = DateTime.fromMillis(at).setZone(cfg.timezone);
  if (!cfg.workingDays.includes(dt.weekday)) return false;
  const h = dt.hour + dt.minute / 60;
  return h >= cfg.workStartHour && h < cfg.workEndHour;
}

/**
 * Prossimo istante (epoch ms) in cui la finestra lavorativa è aperta.
 * Se è già aperta, ritorna `at`.
 */
export function nextWindowOpen(cfg: SafetyConfig, at: number = Date.now()): number {
  let dt = DateTime.fromMillis(at).setZone(cfg.timezone);
  for (let i = 0; i < 14; i++) {
    const candidate =
      i === 0 && inWorkingWindow(cfg, dt.toMillis())
        ? dt
        : dt.plus({ days: i }).set({
            hour: Math.floor(cfg.workStartHour),
            minute: Math.round((cfg.workStartHour % 1) * 60),
            second: 0,
            millisecond: 0,
          });
    if (cfg.workingDays.includes(candidate.weekday) && candidate.toMillis() >= at) {
      // se la finestra di oggi è già passata, salta a domani
      const h = candidate.hour + candidate.minute / 60;
      if (i === 0 && h >= cfg.workEndHour) continue;
      return candidate.toMillis();
    }
  }
  return at; // fallback
}

/** Millisecondi rimasti nella finestra lavorativa di oggi (0 se chiusa). */
export function msLeftInWindow(cfg: SafetyConfig, at: number = Date.now()): number {
  if (!inWorkingWindow(cfg, at)) return 0;
  const dt = DateTime.fromMillis(at).setZone(cfg.timezone);
  const end = dt.set({
    hour: Math.floor(cfg.workEndHour),
    minute: Math.round((cfg.workEndHour % 1) * 60),
    second: 0,
    millisecond: 0,
  });
  return Math.max(0, end.toMillis() - at);
}

/** Numero intero di giorni trascorsi tra due epoch ms. */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / 86_400_000);
}

/** Settimane intere trascorse da una data ISO a ora (>=0). */
export function weeksSince(isoStartDate: string | null, tz: string, at: number = Date.now()): number {
  if (!isoStartDate) return 0;
  const start = DateTime.fromISO(isoStartDate, { zone: tz }).startOf('day');
  if (!start.isValid) return 0;
  const now = DateTime.fromMillis(at).setZone(tz);
  return Math.max(0, Math.floor(now.diff(start, 'weeks').weeks));
}

/** Epoch ms di N giorni fa. */
export function daysAgoMs(days: number, at: number = Date.now()): number {
  return at - days * 86_400_000;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
