// Controller adattivo: rampa, tetti, backoff e halt.
// Gira su un database temporaneo: LKSQ_DATA_DIR va impostata PRIMA di
// importare config.ts, che la legge una volta sola all'import.
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

/** Riporta DB e stato ai default fra un test e l'altro. */
function reset(): void {
  const db = getDb();
  db.exec('DELETE FROM actions; DELETE FROM signals; DELETE FROM campaign_contacts;');
  repo.saveSafetyConfig({ ...DEFAULT_SAFETY_CONFIG, warmupStartDate: null });
  repo.saveControllerState({ ...DEFAULT_CONTROLLER_STATE });
}

test('la rampa segue le settimane trascorse dall\'inizio del warm-up', () => {
  reset();
  const cfg = repo.getSafetyConfig();
  const now = Date.UTC(2026, 0, 29); // giovedì

  cfg.warmupStartDate = '2026-01-29'; // settimana 1
  assert.equal(controller.rampDailyTarget(cfg, now), 12);

  cfg.warmupStartDate = '2026-01-15'; // due settimane fa -> settimana 3
  assert.equal(controller.rampDailyTarget(cfg, now), 18);

  cfg.warmupStartDate = '2025-01-01'; // oltre la fine della rampa: resta all'ultimo gradino
  assert.equal(controller.rampDailyTarget(cfg, now), 25);
});

test('rampStartWeekOffset salta avanti per account già maturi', () => {
  reset();
  const cfg = repo.getSafetyConfig();
  cfg.warmupStartDate = '2026-01-29';
  cfg.rampStartWeekOffset = 3;
  assert.equal(controller.rampDailyTarget(cfg, Date.UTC(2026, 0, 29)), 20);
});

test('remainingToday tiene conto del target giornaliero, del cap e del tetto settimanale', () => {
  reset();
  const state = repo.getControllerState();
  state.currentDailyTarget = 10;
  state.currentWeeklyCeiling = 100;
  repo.saveControllerState(state);

  assert.equal(controller.remainingToday('connect'), 10);
  for (let i = 0; i < 4; i++) repo.logAction({ type: 'connect', status: 'success' });
  assert.equal(controller.remainingToday('connect'), 6);

  // Il cap assoluto sul tipo di azione vince sul target della rampa.
  const cfg = repo.getSafetyConfig();
  cfg.caps.invites = 5;
  repo.saveSafetyConfig(cfg);
  assert.equal(controller.remainingToday('connect'), 1);
});

test('le azioni fallite non consumano il budget giornaliero', () => {
  reset();
  const state = repo.getControllerState();
  state.currentDailyTarget = 3;
  repo.saveControllerState(state);
  repo.logAction({ type: 'connect', status: 'failed' });
  repo.logAction({ type: 'connect', status: 'blocked' });
  assert.equal(controller.remainingToday('connect'), 3);
});

test('un segnale di limite settimanale abbassa il tetto e mette in backoff', () => {
  reset();
  const before = repo.getControllerState().currentWeeklyCeiling;
  const now = Date.now();
  controller.onSignal('weekly_limit', 2, 'modale limite', now);

  const after = repo.getControllerState();
  assert.ok(after.currentWeeklyCeiling < before, 'il tetto settimanale deve scendere');
  assert.ok(after.backoffUntil !== null && after.backoffUntil > now, 'deve esserci un backoff attivo');
  assert.equal(controller.actionAllowedNow('connect', now).ok, false);

  // Il backoff riguarda gli inviti, non le azioni soft come le visite.
  assert.equal(controller.actionAllowedNow('visit', now).ok, true);
});

test('captcha e restrizione fermano tutto finché non si azzera l\'halt a mano', () => {
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

test('il tetto adattivo non supera mai quello configurato', () => {
  reset();
  const state = repo.getControllerState();
  state.currentWeeklyCeiling = 500; // valore incoerente, es. dopo un abbassamento della config
  repo.saveControllerState(state);

  const cfg = repo.getSafetyConfig();
  cfg.weeklyInviteCeiling = 60;
  repo.saveSafetyConfig(cfg);

  const out = controller.recomputeDaily();
  assert.equal(out.currentWeeklyCeiling, 60);
});

test('un acceptance rate sotto soglia riduce il target giornaliero', () => {
  reset();
  const cfg = repo.getSafetyConfig();
  cfg.warmupStartDate = '2020-01-01'; // fine rampa: 25/giorno
  cfg.caps.invites = 30;
  repo.saveSafetyConfig(cfg);

  const pieno = controller.recomputeDaily().currentDailyTarget;
  assert.equal(pieno, 25);

  // 10 inviti inviati, nessuno accettato -> acceptance 0%, sotto la soglia del 40%.
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
  assert.ok(controller.recomputeDaily().currentDailyTarget < pieno, 'il target deve scendere');
});

test('il backlog di inviti pendenti pieno blocca nuovi inviti', () => {
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
