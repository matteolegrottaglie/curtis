// ============================================================
//  Adaptive Limit Controller — il "cuore" anti-ban.
//
//  Ispirato all'"Activity Control" dei tool cloud: NON è una rampa
//  statica, è un controllo a circuito chiuso che:
//   - segue la rampa di warm-up (per settimane trascorse)
//   - frena se l'acceptance rate scende sotto soglia
//   - va in backoff sui segnali di LinkedIn (warning/limit)
//   - si ferma del tutto su captcha/restrizione (halt)
//   - recupera gradualmente i limiti dopo giorni "puliti"
//
//  Il tetto settimanale (`currentWeeklyCeiling`) è la manopola
//  adattiva: scende sui segnali, risale piano quando tutto è ok,
//  ma non supera mai `cfg.weeklyInviteCeiling`.
// ============================================================
import { DateTime } from 'luxon';
import * as repo from '../db/repo.js';
import type { ActionKind, ControllerState, SafetyConfig, SignalKind } from '../types.js';
import { weeksSince, isoDate, daysAgoMs } from '../util/time.js';
import { log } from '../util/log.js';

const HARD_MIN_WEEKLY = 20; // non scendere mai sotto, anche in backoff

function startOfDayMs(tz: string, at: number = Date.now()): number {
  return DateTime.fromMillis(at).setZone(tz).startOf('day').toMillis();
}

/** Mappa un ActionKind alla chiave corrispondente in caps. null per kind senza tetto. */
export function capKeyFor(kind: ActionKind): keyof SafetyConfig['caps'] | null {
  switch (kind) {
    case 'connect':
      return 'invites';
    case 'message':
      return 'messages';
    case 'visit':
      return 'visits';
    case 'follow':
      return 'follows';
    case 'like':
      return 'likes';
    case 'withdraw':
      return 'withdraws';
    case 'check_accepted':
      return null;
  }
}

function capFor(cfg: SafetyConfig, kind: ActionKind): number {
  const k = capKeyFor(kind);
  return k == null ? Number.MAX_SAFE_INTEGER : cfg.caps[k];
}

/** Target inviti/giorno previsto dalla rampa per la settimana corrente. */
export function rampDailyTarget(cfg: SafetyConfig, at: number = Date.now()): number {
  const wk = weeksSince(cfg.warmupStartDate, cfg.timezone, at) + 1 + cfg.rampStartWeekOffset;
  const sorted = [...cfg.ramp].sort((a, b) => a.week - b.week);
  let target = sorted[0]?.dailyInvites ?? 0;
  for (const r of sorted) if (r.week <= wk) target = r.dailyInvites;
  return target;
}

/** Quante azioni di un certo tipo restano disponibili oggi. */
export function remainingToday(kind: ActionKind, at: number = Date.now()): number {
  const cfg = repo.getSafetyConfig();
  const state = repo.getControllerState();
  const since = startOfDayMs(cfg.timezone, at);
  const sentToday = repo.countActions({ type: kind, status: 'success', since });
  const cap = capFor(cfg, kind);

  if (kind === 'connect') {
    const dailyRemaining = state.currentDailyTarget - sentToday;
    const weekRemaining = state.currentWeeklyCeiling - repo.invitesInWindow(7, at);
    return Math.max(0, Math.min(cap - sentToday, dailyRemaining, weekRemaining));
  }
  return Math.max(0, cap - sentToday);
}

export interface Permission {
  ok: boolean;
  reason?: string;
}

/**
 * Può eseguire ORA un'azione di questo tipo?
 * Se `perCampaign` è passato, applica anche il tetto per-campagna in aggiunta a quelli globali.
 */
export function actionAllowedNow(
  kind: ActionKind,
  at: number = Date.now(),
  perCampaign?: { campaignId: string; cap: number },
): Permission {
  const cfg = repo.getSafetyConfig();
  const state = repo.getControllerState();

  if (state.haltedReason) return { ok: false, reason: `HALT: ${state.haltedReason}` };
  if (state.paused) return { ok: false, reason: 'in pausa (manuale)' };

  if (kind === 'connect') {
    if (state.backoffUntil && at < state.backoffUntil) {
      const mins = Math.round((state.backoffUntil - at) / 60000);
      return { ok: false, reason: `backoff inviti per altri ~${mins} min` };
    }
    if (repo.pendingInvitesCount() >= cfg.maxPendingBacklog) {
      return { ok: false, reason: `backlog inviti pendenti pieno (>= ${cfg.maxPendingBacklog})` };
    }
  }

  if (remainingToday(kind, at) <= 0) {
    return { ok: false, reason: `cap giornaliero raggiunto per "${kind}"` };
  }

  // Tetto per-campagna (override). Se la campagna ha un suo cap, conta solo le azioni
  // di QUESTA campagna oggi e verifica che non lo abbia ancora raggiunto.
  if (perCampaign && perCampaign.cap > 0) {
    const since = startOfDayMs(cfg.timezone, at);
    const sentForCampaign = repo.countActions({
      type: kind,
      status: 'success',
      since,
      campaign_id: perCampaign.campaignId,
    });
    if (sentForCampaign >= perCampaign.cap) {
      return { ok: false, reason: `cap per-campagna raggiunto per "${kind}"` };
    }
  }
  return { ok: true };
}

/**
 * Da chiamare quando un guard rileva un segnale di LinkedIn.
 * Applica backoff / halt e abbassa il tetto adattivo.
 */
export function onSignal(kind: SignalKind, severity: number, detail?: string, at: number = Date.now()): void {
  const cfg = repo.getSafetyConfig();
  const state = repo.getControllerState();
  repo.logSignal(kind, severity, detail);
  state.lastSignalAt = at;
  state.consecutiveCleanDays = 0;

  if (kind === 'captcha' || kind === 'restriction') {
    // Stop totale: serve intervento umano.
    state.haltedReason = `${kind}${detail ? ' — ' + detail : ''}`;
    log.error({ kind, detail }, 'HALT di sicurezza: intervieni manualmente su LinkedIn');
  } else if (kind === 'weekly_limit') {
    state.backoffUntil = at + 24 * 3600_000; // ricontrolla domani
    state.currentWeeklyCeiling = Math.max(
      HARD_MIN_WEEKLY,
      Math.floor(state.currentWeeklyCeiling * cfg.backoffFactor),
    );
    log.warn({ ceiling: state.currentWeeklyCeiling }, 'limite settimanale LinkedIn: backoff inviti');
  } else if (kind === 'warning' || kind === 'error') {
    state.backoffUntil = at + cfg.backoffCooldownHours * 3600_000;
    state.currentWeeklyCeiling = Math.max(
      HARD_MIN_WEEKLY,
      Math.floor(state.currentWeeklyCeiling * cfg.backoffFactor),
    );
    log.warn({ kind, detail }, 'segnale di avviso: backoff e riduzione limiti');
  }
  repo.saveControllerState(state);
}

/**
 * Ricalcolo giornaliero: target del giorno, recupero graduale dei limiti,
 * gestione warm-up. Idempotente nello stesso giorno.
 */
export function recomputeDaily(at: number = Date.now()): ControllerState {
  const cfg = repo.getSafetyConfig();
  const state = repo.getControllerState();
  const today = isoDate(cfg.timezone, at);

  // Acceptance rate: se sotto soglia, frena.
  const accept = repo.acceptanceRate(30, at);
  let base = rampDailyTarget(cfg, at);
  if (accept !== null && accept < cfg.minAcceptanceRate) {
    base = Math.max(1, Math.floor(base * cfg.backoffFactor));
    log.warn(
      { acceptance: Number(accept.toFixed(2)), soglia: cfg.minAcceptanceRate },
      'acceptance rate basso: target inviti ridotto. Migliora targeting/messaggio.',
    );
  }
  state.currentDailyTarget = Math.min(base, cfg.caps.invites);

  // Cambio giorno → bookkeeping recupero.
  if (state.lastAdjustedDate !== today) {
    const hadRecentSignal = state.lastSignalAt !== null && state.lastSignalAt >= daysAgoMs(1, at);
    if (hadRecentSignal) {
      state.consecutiveCleanDays = 0;
    } else {
      state.consecutiveCleanDays += 1;
      // Recupero graduale del tetto verso il massimo configurato.
      if (
        state.consecutiveCleanDays >= cfg.cleanDaysToRecover &&
        state.currentWeeklyCeiling < cfg.weeklyInviteCeiling
      ) {
        const step = Math.max(2, Math.ceil(state.currentWeeklyCeiling * cfg.recoveryStepPct));
        state.currentWeeklyCeiling = Math.min(
          cfg.weeklyInviteCeiling,
          state.currentWeeklyCeiling + step,
        );
        log.info({ ceiling: state.currentWeeklyCeiling }, 'recupero limiti: tetto settimanale rialzato');
      }
    }
    // Se il backoff è scaduto, azzeralo.
    if (state.backoffUntil && at >= state.backoffUntil) state.backoffUntil = null;
    state.lastAdjustedDate = today;
  }

  // Assicura che il tetto effettivo non superi quello configurato (es. dopo modifica da dashboard).
  state.currentWeeklyCeiling = Math.min(state.currentWeeklyCeiling, cfg.weeklyInviteCeiling);

  repo.saveControllerState(state);
  return state;
}

// ---- Controlli manuali ----
export function pause(): void {
  const s = repo.getControllerState();
  s.paused = true;
  repo.saveControllerState(s);
}
export function resume(): void {
  const s = repo.getControllerState();
  s.paused = false;
  repo.saveControllerState(s);
}
export function clearHalt(): void {
  const s = repo.getControllerState();
  s.haltedReason = null;
  s.backoffUntil = null;
  repo.saveControllerState(s);
  log.info('HALT azzerato manualmente');
}
