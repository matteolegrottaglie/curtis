// Adaptive controller: ramp-up, caps, backoff and halt.
// Runs against a throwaway database: LKSQ_DATA_DIR must be set BEFORE
// importing config.ts, which reads it exactly once at import time.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'lksq-test-'));
process.env.LKSQ_DATA_DIR = DATA_DIR;
process.env.LKSQ_NO_AUTH = '1';
process.env.LOG_LEVEL = 'silent';

const { initDb, getDb } = await import('../src/db/index.js');
const repo = await import('../src/db/repo.js');
const controller = await import('../src/safety/controller.js');
const { DEFAULT_SAFETY_CONFIG, DEFAULT_CONTROLLER_STATE } = await import('../src/config.js');

before(() => initDb());

/** Brings DB and state back to defaults between one test and the next. */
function reset(): void {
  const db = getDb();
  db.exec('DELETE FROM actions; DELETE FROM signals; DELETE FROM campaign_contacts;');
  repo.saveSafetyConfig({ ...DEFAULT_SAFETY_CONFIG, warmupStartDate: null });
  repo.saveControllerState({ ...DEFAULT_CONTROLLER_STATE });
}

test('the ramp follows the weeks elapsed since the start of the warm-up', () => {
  reset();
  const cfg = repo.getSafetyConfig();
  const now = Date.UTC(2026, 0, 29); // Thursday

  cfg.warmupStartDate = '2026-01-29'; // week 1
  assert.equal(controller.rampDailyTarget(cfg, now), 12);

  cfg.warmupStartDate = '2026-01-15'; // two weeks ago -> week 3
  assert.equal(controller.rampDailyTarget(cfg, now), 18);

  cfg.warmupStartDate = '2025-01-01'; // past the end of the ramp: stays on the last step
  assert.equal(controller.rampDailyTarget(cfg, now), 25);
});

test('rampStartWeekOffset skips ahead for already seasoned accounts', () => {
  reset();
  const cfg = repo.getSafetyConfig();
  cfg.warmupStartDate = '2026-01-29';
  cfg.rampStartWeekOffset = 3;
  assert.equal(controller.rampDailyTarget(cfg, Date.UTC(2026, 0, 29)), 20);
});

test('remainingToday accounts for the daily target, the cap and the weekly ceiling', () => {
  reset();
  const state = repo.getControllerState();
  state.currentDailyTarget = 10;
  state.currentWeeklyCeiling = 100;
  repo.saveControllerState(state);

  assert.equal(controller.remainingToday('connect'), 10);
  for (let i = 0; i < 4; i++) repo.logAction({ type: 'connect', status: 'success' });
  assert.equal(controller.remainingToday('connect'), 6);

  // The hard cap on the action type beats the ramp target.
  const cfg = repo.getSafetyConfig();
  cfg.caps.invites = 5;
  repo.saveSafetyConfig(cfg);
  assert.equal(controller.remainingToday('connect'), 1);
});

test('failed actions do not eat into the daily budget', () => {
  reset();
  const state = repo.getControllerState();
  state.currentDailyTarget = 3;
  repo.saveControllerState(state);
  repo.logAction({ type: 'connect', status: 'failed' });
  repo.logAction({ type: 'connect', status: 'blocked' });
  assert.equal(controller.remainingToday('connect'), 3);
});

test('a weekly-limit signal lowers the ceiling and triggers a backoff', () => {
  reset();
  const before = repo.getControllerState().currentWeeklyCeiling;
  const now = Date.now();
  controller.onSignal('weekly_limit', 2, 'limit modal', now);

  const after = repo.getControllerState();
  assert.ok(after.currentWeeklyCeiling < before, 'the weekly ceiling must come down');
  assert.ok(after.backoffUntil !== null && after.backoffUntil > now, 'a backoff must be active');
  assert.equal(controller.actionAllowedNow('connect', now).ok, false);

  // The backoff covers invites, not soft actions such as visits.
  assert.equal(controller.actionAllowedNow('visit', now).ok, true);
});

test('captcha and restriction stop everything until the halt is cleared by hand', () => {
  reset();
  controller.onSignal('captcha', 3, 'checkpoint');
  const state = repo.getControllerState();
  assert.ok(state.haltedReason?.startsWith('captcha'));
  assert.equal(controller.actionAllowedNow('visit').ok, false);
  assert.equal(controller.actionAllowedNow('connect').ok, false);

  controller.clearHalt();
  assert.equal(repo.getControllerState().haltedReason, null);
  assert.equal(controller.actionAllowedNow('visit').ok, true);
});

test('the adaptive ceiling never goes above the configured one', () => {
  reset();
  const state = repo.getControllerState();
  state.currentWeeklyCeiling = 500; // inconsistent value, e.g. after the config was lowered
  repo.saveControllerState(state);

  const cfg = repo.getSafetyConfig();
  cfg.weeklyInviteCeiling = 60;
  repo.saveSafetyConfig(cfg);

  const out = controller.recomputeDaily();
  assert.equal(out.currentWeeklyCeiling, 60);
});

test('an acceptance rate below threshold cuts the daily target', () => {
  reset();
  const cfg = repo.getSafetyConfig();
  cfg.warmupStartDate = '2020-01-01'; // end of the ramp: 25/day
  cfg.caps.invites = 30;
  repo.saveSafetyConfig(cfg);

  const full = controller.recomputeDaily().currentDailyTarget;
  assert.equal(full, 25);

  // 10 invites sent, none accepted -> acceptance 0%, below the 40% threshold.
  const db = getDb();
  const now = Date.now();
  db.exec("INSERT INTO campaigns (id,name,status,steps,created_at,updated_at) VALUES ('camp','c','draft','[]',0,0)");
  for (let i = 0; i < 10; i++) {
    db.prepare('INSERT INTO contacts (id, profile_url, created_at) VALUES (?, ?, ?)').run(`ct${i}`, `https://x/${i}`, now);
    db.prepare(
      'INSERT INTO campaign_contacts (id,campaign_id,contact_id,status,current_step,connect_sent_at,created_at) VALUES (?,?,?,?,0,?,?)',
    ).run(`e${i}`, 'camp', `ct${i}`, 'connect_sent', now, now);
  }
  assert.equal(repo.acceptanceRate(30), 0);
  assert.ok(controller.recomputeDaily().currentDailyTarget < full, 'the target must come down');
});

test('a full backlog of pending invites blocks new invites', () => {
  reset();
  const cfg = repo.getSafetyConfig();
  cfg.maxPendingBacklog = 50;
  repo.saveSafetyConfig(cfg);
  const state = repo.getControllerState();
  state.currentDailyTarget = 10;
  repo.saveControllerState(state);

  const db = getDb();
  db.exec("INSERT INTO campaigns (id,name,status,steps,created_at,updated_at) VALUES ('camp2','c','draft','[]',0,0)");
  for (let i = 0; i < 50; i++) {
    db.prepare('INSERT INTO contacts (id, profile_url, created_at) VALUES (?, ?, ?)').run(`p${i}`, `https://y/${i}`, 0);
    db.prepare(
      'INSERT INTO campaign_contacts (id,campaign_id,contact_id,status,current_step,created_at) VALUES (?,?,?,?,0,0)',
    ).run(`pe${i}`, 'camp2', `p${i}`, 'connect_sent');
  }
  const perm = controller.actionAllowedNow('connect');
  assert.equal(perm.ok, false);
  assert.match(perm.reason ?? '', /backlog/i);
});

after(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});
