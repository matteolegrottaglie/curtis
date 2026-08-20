// ============================================================
//  Adaptive Limit Controller — the heart of the safety system.
//
//  Not a static schedule: a closed-loop control that
//   - follows the warm-up ramp (by weeks elapsed)
//   - brakes when the acceptance rate falls below the threshold
//   - backs off on LinkedIn signals (warning / limit)
//   - stops entirely on a captcha or a restriction (halt)
//   - recovers the limits gradually after "clean" days
//
//  The weekly ceiling (`currentWeeklyCeiling`) is the adaptive knob:
//  it drops on signals, climbs back slowly while everything is fine,
//  and never exceeds `cfg.weeklyInviteCeiling`.
// ============================================================
import { DateTime } from 'luxon';
import * as repo from '../db/repo.js';
import type { ActionKind, ControllerState, SafetyConfig, SignalKind } from '../types.js';
import { weeksSince, isoDate, daysAgoMs } from '../util/time.js';
import { log } from '../util/log.js';

const HARD_MIN_WEEKLY = 20; // never go below this, not even while backing off

function startOfDayMs(tz: string, at: number = Date.now()): number {
  return DateTime.fromMillis(at).setZone(tz).startOf('day').toMillis();
}

/** Maps an ActionKind to its key in caps. null for kinds with no ceiling. */
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

/** Invites/day the ramp calls for in the current week. */
export function rampDailyTarget(cfg: SafetyConfig, at: number = Date.now()): number {
  const wk = weeksSince(cfg.warmupStartDate, cfg.timezone, at) + 1 + cfg.rampStartWeekOffset;
  const sorted = [...cfg.ramp].sort((a, b) => a.week - b.week);
  let target = sorted[0]?.dailyInvites ?? 0;
  for (const r of sorted) if (r.week <= wk) target = r.dailyInvites;
  return target;
}

/** How many actions of a given kind are still available today. */
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
 * May an action of this kind run RIGHT NOW?
 * When `perCampaign` is given, its ceiling applies on top of the global ones.
 */
export function actionAllowedNow(
  kind: ActionKind,
  at: number = Date.now(),
  perCampaign?: { campaignId: string; cap: number },
): Permission {
  const cfg = repo.getSafetyConfig();
  const state = repo.getControllerState();

  if (state.haltedReason) return { ok: false, reason: `HALT: ${state.haltedReason}` };
  if (state.paused) return { ok: false, reason: 'paused (manually)' };

  if (kind === 'connect') {
    if (state.backoffUntil && at < state.backoffUntil) {
      const mins = Math.round((state.backoffUntil - at) / 60000);
      return { ok: false, reason: `invites backing off for another ~${mins} min` };
    }
    if (repo.pendingInvitesCount() >= cfg.maxPendingBacklog) {
      return { ok: false, reason: `pending invite backlog full (>= ${cfg.maxPendingBacklog})` };
    }
  }

  if (remainingToday(kind, at) <= 0) {
    return { ok: false, reason: `daily cap reached for "${kind}"` };
  }

  // Per-campaign ceiling (override). When a campaign sets its own cap, count only
  // THIS campaign's actions today and check it has not reached the cap yet.
  if (perCampaign && perCampaign.cap > 0) {
    const since = startOfDayMs(cfg.timezone, at);
    const sentForCampaign = repo.countActions({
      type: kind,
      status: 'success',
      since,
      campaign_id: perCampaign.campaignId,
    });
    if (sentForCampaign >= perCampaign.cap) {
      return { ok: false, reason: `per-campaign cap reached for "${kind}"` };
    }
  }
  return { ok: true };
}

/**
 * Call this when a guard detects a LinkedIn signal.
 * Applies backoff or halt and lowers the adaptive ceiling.
 */
export function onSignal(kind: SignalKind, severity: number, detail?: string, at: number = Date.now()): void {
  const cfg = repo.getSafetyConfig();
  const state = repo.getControllerState();
  repo.logSignal(kind, severity, detail);
  state.lastSignalAt = at;
  state.consecutiveCleanDays = 0;

  if (kind === 'captcha' || kind === 'restriction') {
    // Full stop: a human has to step in.
    state.haltedReason = `${kind}${detail ? ' — ' + detail : ''}`;
    log.error({ kind, detail }, 'safety HALT: sort this out manually on LinkedIn');
  } else if (kind === 'weekly_limit') {
    state.backoffUntil = at + 24 * 3600_000; // check again tomorrow
    state.currentWeeklyCeiling = Math.max(
      HARD_MIN_WEEKLY,
      Math.floor(state.currentWeeklyCeiling * cfg.backoffFactor),
    );
    log.warn({ ceiling: state.currentWeeklyCeiling }, 'LinkedIn weekly limit: backing off invites');
  } else if (kind === 'warning' || kind === 'error') {
    state.backoffUntil = at + cfg.backoffCooldownHours * 3600_000;
    state.currentWeeklyCeiling = Math.max(
      HARD_MIN_WEEKLY,
      Math.floor(state.currentWeeklyCeiling * cfg.backoffFactor),
    );
    log.warn({ kind, detail }, 'warning signal: backing off and lowering the limits');
  }
  repo.saveControllerState(state);
}

/**
 * Daily recomputation: today's target, gradual recovery of the limits,
 * warm-up handling. Idempotent within the same day.
 */
export function recomputeDaily(at: number = Date.now()): ControllerState {
  const cfg = repo.getSafetyConfig();
  const state = repo.getControllerState();
  const today = isoDate(cfg.timezone, at);

  // Acceptance rate: brake when it is below the threshold.
  const accept = repo.acceptanceRate(30, at);
  let base = rampDailyTarget(cfg, at);
  if (accept !== null && accept < cfg.minAcceptanceRate) {
    base = Math.max(1, Math.floor(base * cfg.backoffFactor));
    log.warn(
      { acceptance: Number(accept.toFixed(2)), threshold: cfg.minAcceptanceRate },
      'low acceptance rate: invite target reduced. Improve the targeting or the message.',
    );
  }
  state.currentDailyTarget = Math.min(base, cfg.caps.invites);

  // Day rollover -> recovery bookkeeping.
  if (state.lastAdjustedDate !== today) {
    const hadRecentSignal = state.lastSignalAt !== null && state.lastSignalAt >= daysAgoMs(1, at);
    if (hadRecentSignal) {
      state.consecutiveCleanDays = 0;
    } else {
      state.consecutiveCleanDays += 1;
      // Gradual recovery of the ceiling towards the configured maximum.
      if (
        state.consecutiveCleanDays >= cfg.cleanDaysToRecover &&
        state.currentWeeklyCeiling < cfg.weeklyInviteCeiling
      ) {
        const step = Math.max(2, Math.ceil(state.currentWeeklyCeiling * cfg.recoveryStepPct));
        state.currentWeeklyCeiling = Math.min(
          cfg.weeklyInviteCeiling,
          state.currentWeeklyCeiling + step,
        );
        log.info({ ceiling: state.currentWeeklyCeiling }, 'limits recovering: weekly ceiling raised');
      }
    }
    // Clear the backoff once it has expired.
    if (state.backoffUntil && at >= state.backoffUntil) state.backoffUntil = null;
    state.lastAdjustedDate = today;
  }

  // Make sure the effective ceiling never exceeds the configured one (e.g. after a settings change).
  state.currentWeeklyCeiling = Math.min(state.currentWeeklyCeiling, cfg.weeklyInviteCeiling);

  repo.saveControllerState(state);
  return state;
}

// ---- Manual controls ----
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
  log.info('HALT cleared manually');
}
