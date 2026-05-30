// ============================================================
//  Data-access layer: tutte le query tipizzate.
// ============================================================
import { randomUUID } from 'node:crypto';
import { getDb } from './index.js';
import type {
  ActionKind,
  ActionStatus,
  Campaign,
  CampaignContact,
  CampaignStatus,
  Contact,
  ControllerState,
  EnrollmentStatus,
  SafetyConfig,
  SignalKind,
  Step,
} from '../types.js';
import { daysAgoMs } from '../util/time.js';

const now = () => Date.now();

// ---------------- Settings ----------------
export function getSafetyConfig(): SafetyConfig {
  const row = getDb().prepare('SELECT json FROM settings WHERE id = 1').get() as
    | { json: string }
    | undefined;
  if (!row) throw new Error('settings non inizializzate');
  return JSON.parse(row.json) as SafetyConfig;
}

export function saveSafetyConfig(cfg: SafetyConfig): void {
  getDb().prepare('UPDATE settings SET json = ? WHERE id = 1').run(JSON.stringify(cfg));
}

// ---------------- Controller state ----------------
export function getControllerState(): ControllerState {
  const row = getDb().prepare('SELECT json FROM controller_state WHERE id = 1').get() as
    | { json: string }
    | undefined;
  if (!row) throw new Error('controller_state non inizializzato');
  return JSON.parse(row.json) as ControllerState;
}

export function saveControllerState(s: ControllerState): void {
  getDb().prepare('UPDATE controller_state SET json = ? WHERE id = 1').run(JSON.stringify(s));
}

// ---------------- Contacts ----------------
export interface ContactInput {
  profile_url: string;
  public_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  headline?: string | null;
  company?: string | null;
  location?: string | null;
  email?: string | null;
  custom?: Record<string, string> | null;
  source?: string | null;
}

/**
 * Inserisce contatti deduplicando per profile_url.
 * Ritorna {inserted, skipped, ids} dove `ids` sono gli ID di TUTTI i contatti referenziati
 * dal file (sia quelli appena inseriti sia i duplicati già esistenti). Serve a "annulla import":
 * permette di rimuovere esattamente i contatti del file, duplicati inclusi.
 */
export function upsertContacts(
  list: ContactInput[],
): { inserted: number; skipped: number; ids: string[] } {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO contacts (id, profile_url, public_id, first_name, last_name, full_name,
                          headline, company, location, email, custom, source, created_at)
    VALUES (@id, @profile_url, @public_id, @first_name, @last_name, @full_name,
            @headline, @company, @location, @email, @custom, @source, @created_at)
    ON CONFLICT(profile_url) DO NOTHING
  `);
  const findId = db.prepare('SELECT id FROM contacts WHERE profile_url = ?');
  let inserted = 0;
  const ids: string[] = [];
  const tx = db.transaction((rows: ContactInput[]) => {
    for (const r of rows) {
      const res = insert.run({
        id: randomUUID(),
        profile_url: r.profile_url,
        public_id: r.public_id ?? null,
        first_name: r.first_name ?? null,
        last_name: r.last_name ?? null,
        full_name: r.full_name ?? null,
        headline: r.headline ?? null,
        company: r.company ?? null,
        location: r.location ?? null,
        email: r.email ?? null,
        custom: r.custom ? JSON.stringify(r.custom) : null,
        source: r.source ?? null,
        created_at: now(),
      });
      if (res.changes > 0) inserted++;
      const row = findId.get(r.profile_url) as { id: string } | undefined;
      if (row) ids.push(row.id);
    }
  });
  tx(list);
  return { inserted, skipped: list.length - inserted, ids };
}

export function getContact(id: string): Contact | undefined {
  return getDb().prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Contact | undefined;
}

/** Ritorna i contatti per lista di ID (chunked). Usato per la preview "contatti del file importato". */
export function getContactsByIds(ids: string[]): Contact[] {
  if (!ids.length) return [];
  const db = getDb();
  const out: Contact[] = [];
  const CHUNK = 400;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const ph = chunk.map(() => '?').join(',');
    out.push(...(db.prepare(`SELECT * FROM contacts WHERE id IN (${ph})`).all(...chunk) as Contact[]));
  }
  return out;
}

export function listContacts(
  opts: { limit?: number; offset?: number; search?: string } = {},
): Contact[] {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  if (opts.search) {
    const q = `%${opts.search}%`;
    return getDb()
      .prepare(
        `SELECT * FROM contacts WHERE full_name LIKE ? OR company LIKE ? OR profile_url LIKE ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(q, q, q, limit, offset) as Contact[];
  }
  return getDb()
    .prepare('SELECT * FROM contacts ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as Contact[];
}

export function countContacts(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM contacts').get() as { n: number }).n;
}

/**
 * Cancella i contatti per ID (chunked per restare sotto il limite parametri di SQLite).
 * Con `onlyUnenrolled=true` salta i contatti già iscritti a una campagna, così "annulla import"
 * non rompe campagne esistenti. Le iscrizioni dei contatti rimossi vanno via in cascata.
 * Restituisce il numero di righe effettivamente rimosse.
 */
export function deleteContactsByIds(ids: string[], onlyUnenrolled = false): number {
  if (!ids.length) return 0;
  const db = getDb();
  const CHUNK = 400;
  let total = 0;
  const tx = db.transaction((all: string[]) => {
    for (let i = 0; i < all.length; i += CHUNK) {
      const chunk = all.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      let sql = `DELETE FROM contacts WHERE id IN (${ph})`;
      if (onlyUnenrolled) {
        sql += ` AND id NOT IN (SELECT contact_id FROM campaign_contacts WHERE contact_id IS NOT NULL)`;
      }
      total += db.prepare(sql).run(...chunk).changes;
    }
  });
  tx(ids);
  return total;
}

// ---------------- Campaigns ----------------
export function createCampaign(name: string, steps: Step[], settings?: object): Campaign {
  const db = getDb();
  const id = randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO campaigns (id, name, status, steps, settings, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
  ).run(id, name, JSON.stringify(steps), settings ? JSON.stringify(settings) : null, ts, ts);
  return getCampaign(id)!;
}

export function getCampaign(id: string): Campaign | undefined {
  return getDb().prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Campaign | undefined;
}

export function listCampaigns(): Campaign[] {
  return getDb().prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all() as Campaign[];
}

export function updateCampaign(
  id: string,
  patch: { name?: string; steps?: Step[]; settings?: object | null },
): void {
  const c = getCampaign(id);
  if (!c) throw new Error('campagna non trovata');
  getDb()
    .prepare('UPDATE campaigns SET name = ?, steps = ?, settings = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.name ?? c.name,
      patch.steps ? JSON.stringify(patch.steps) : c.steps,
      patch.settings !== undefined
        ? patch.settings
          ? JSON.stringify(patch.settings)
          : null
        : c.settings,
      now(),
      id,
    );
}

export function setCampaignStatus(id: string, status: CampaignStatus): void {
  getDb()
    .prepare('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, now(), id);
}

export function deleteCampaign(id: string): void {
  getDb().prepare('DELETE FROM campaigns WHERE id = ?').run(id);
}

export function parseSteps(c: Campaign): Step[] {
  return JSON.parse(c.steps) as Step[];
}

// ---------------- Campaign contacts (enrollment) ----------------
export function enrollContacts(campaignId: string, contactIds: string[]): number {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO campaign_contacts (id, campaign_id, contact_id, status, current_step, created_at)
    VALUES (?, ?, ?, 'enrolled', 0, ?)
    ON CONFLICT(campaign_id, contact_id) DO NOTHING
  `);
  let n = 0;
  const tx = db.transaction((ids: string[]) => {
    for (const cid of ids) {
      const res = insert.run(randomUUID(), campaignId, cid, now());
      if (res.changes > 0) n++;
    }
  });
  tx(contactIds);
  return n;
}

export interface DueEnrollment {
  enrollment: CampaignContact;
  contact: Contact;
  campaign: Campaign;
}

/** Iscrizioni pronte per la prossima azione (solo campagne running). */
export function getDueEnrollments(limit = 50, at: number = now()): DueEnrollment[] {
  const rows = getDb()
    .prepare(
      `SELECT cc.* FROM campaign_contacts cc
       JOIN campaigns c ON c.id = cc.campaign_id
       WHERE c.status = 'running'
         AND cc.status IN ('enrolled','in_progress','connect_sent','accepted')
         AND (cc.next_action_at IS NULL OR cc.next_action_at <= ?)
       ORDER BY (cc.next_action_at IS NULL) DESC, cc.next_action_at ASC
       LIMIT ?`,
    )
    .all(at, limit) as CampaignContact[];

  const out: DueEnrollment[] = [];
  for (const e of rows) {
    const contact = getContact(e.contact_id);
    const campaign = getCampaign(e.campaign_id);
    if (contact && campaign) out.push({ enrollment: e, contact, campaign });
  }
  return out;
}

export function updateEnrollment(id: string, patch: Partial<CampaignContact>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const set = fields.map((f) => `${f} = @${f}`).join(', ');
  getDb()
    .prepare(`UPDATE campaign_contacts SET ${set} WHERE id = @id`)
    .run({ ...patch, id });
}

export function enrollmentStatusCounts(campaignId: string): Record<string, number> {
  const rows = getDb()
    .prepare(
      'SELECT status, COUNT(*) AS n FROM campaign_contacts WHERE campaign_id = ? GROUP BY status',
    )
    .all(campaignId) as { status: EnrollmentStatus; n: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** Iscrizioni in 'connect_sent' da più di N giorni (per check accettazione / withdraw). */
export function staleConnectSent(olderThanDays: number, at: number = now()): DueEnrollment[] {
  const cutoff = daysAgoMs(olderThanDays, at);
  const rows = getDb()
    .prepare(
      `SELECT * FROM campaign_contacts
       WHERE status = 'connect_sent' AND connect_sent_at IS NOT NULL AND connect_sent_at <= ?`,
    )
    .all(cutoff) as CampaignContact[];
  const out: DueEnrollment[] = [];
  for (const e of rows) {
    const contact = getContact(e.contact_id);
    const campaign = getCampaign(e.campaign_id);
    if (contact && campaign) out.push({ enrollment: e, contact, campaign });
  }
  return out;
}

// ---------------- Actions ----------------
export function logAction(a: {
  campaign_id?: string | null;
  contact_id?: string | null;
  type: ActionKind;
  status: ActionStatus;
  detail?: string | null;
  screenshot?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO actions (id, campaign_id, contact_id, type, status, detail, screenshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      a.campaign_id ?? null,
      a.contact_id ?? null,
      a.type,
      a.status,
      a.detail ?? null,
      a.screenshot ?? null,
      now(),
    );
}

/** Timestamps di tutte le azioni con un certo tipo+stato a partire da `since`. */
export function actionTimestamps(type: ActionKind, status: ActionStatus, since: number): number[] {
  return (
    getDb()
      .prepare('SELECT created_at AS at FROM actions WHERE type = ? AND status = ? AND created_at >= ? ORDER BY at')
      .all(type, status, since) as Array<{ at: number }>
  ).map((r) => r.at);
}

export function countActions(opts: {
  type?: ActionKind;
  status?: ActionStatus;
  since?: number;
  campaign_id?: string;
}): number {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.type) {
    where.push('type = ?');
    params.push(opts.type);
  }
  if (opts.status) {
    where.push('status = ?');
    params.push(opts.status);
  }
  if (opts.since !== undefined) {
    where.push('created_at >= ?');
    params.push(opts.since);
  }
  if (opts.campaign_id) {
    where.push('campaign_id = ?');
    params.push(opts.campaign_id);
  }
  const sql = `SELECT COUNT(*) AS n FROM actions${
    where.length ? ' WHERE ' + where.join(' AND ') : ''
  }`;
  return (getDb().prepare(sql).get(...params) as { n: number }).n;
}

export interface ActionRowJoined {
  id: string;
  campaign_id: string | null;
  contact_id: string | null;
  type: ActionKind;
  status: ActionStatus;
  detail: string | null;
  screenshot: string | null;
  created_at: number;
  contact_name: string | null;
  contact_url: string | null;
}

export function recentActions(limit = 50): ActionRowJoined[] {
  return getDb()
    .prepare(
      `SELECT a.*, c.full_name AS contact_name, c.profile_url AS contact_url
       FROM actions a LEFT JOIN contacts c ON c.id = a.contact_id
       ORDER BY a.created_at DESC LIMIT ?`,
    )
    .all(limit) as ActionRowJoined[];
}

// ---------------- Signals ----------------
export function logSignal(kind: SignalKind, severity: number, detail?: string): void {
  getDb()
    .prepare('INSERT INTO signals (id, kind, severity, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), kind, severity, detail ?? null, now());
}

export interface SignalLite {
  kind: SignalKind;
  severity: number;
  detail: string | null;
  created_at: number;
}

export function recentSignals(sinceMs: number): SignalLite[] {
  return getDb()
    .prepare(
      'SELECT kind, severity, detail, created_at FROM signals WHERE created_at >= ? ORDER BY created_at DESC',
    )
    .all(sinceMs) as SignalLite[];
}

// ---------------- Stats per controller / dashboard ----------------
export function invitesInWindow(days: number, at: number = now()): number {
  return countActions({ type: 'connect', status: 'success', since: daysAgoMs(days, at) });
}

export function pendingInvitesCount(): number {
  return (
    getDb().prepare("SELECT COUNT(*) AS n FROM campaign_contacts WHERE status = 'connect_sent'").get() as {
      n: number;
    }
  ).n;
}

/** Acceptance rate sugli inviti inviati negli ultimi `days` giorni (null se 0 inviti). */
export function acceptanceRate(days = 30, at: number = now()): number | null {
  const since = daysAgoMs(days, at);
  const sent = (
    getDb()
      .prepare(
        'SELECT COUNT(*) AS n FROM campaign_contacts WHERE connect_sent_at IS NOT NULL AND connect_sent_at >= ?',
      )
      .get(since) as { n: number }
  ).n;
  if (sent === 0) return null;
  const accepted = (
    getDb()
      .prepare(
        'SELECT COUNT(*) AS n FROM campaign_contacts WHERE accepted_at IS NOT NULL AND connect_sent_at IS NOT NULL AND connect_sent_at >= ?',
      )
      .get(since) as { n: number }
  ).n;
  return accepted / sent;
}
