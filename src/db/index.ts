// ============================================================
//  Connessione SQLite (better-sqlite3) + init schema + seed.
// ============================================================
import Database from 'better-sqlite3';
import { paths, ensureDataDir, DEFAULT_SAFETY_CONFIG, DEFAULT_CONTROLLER_STATE } from '../config.js';
import { SCHEMA } from './schema.js';
import { log } from '../util/log.js';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  ensureDataDir();
  const dbPath = paths.db;
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  _db = db;
  log.info({ dbPath }, 'database pronto');
  return db;
}

/** Inserisce i default di sicurezza e lo stato controller se mancanti. */
export function initDb(): void {
  const db = getDb();
  const hasSettings = db.prepare('SELECT 1 FROM settings WHERE id = 1').get();
  if (!hasSettings) {
    db.prepare('INSERT INTO settings (id, json) VALUES (1, ?)').run(
      JSON.stringify(DEFAULT_SAFETY_CONFIG),
    );
    log.info('config di sicurezza inizializzata con i default');
  }
  const hasCtrl = db.prepare('SELECT 1 FROM controller_state WHERE id = 1').get();
  if (!hasCtrl) {
    db.prepare('INSERT INTO controller_state (id, json) VALUES (1, ?)').run(
      JSON.stringify(DEFAULT_CONTROLLER_STATE),
    );
  }
}
