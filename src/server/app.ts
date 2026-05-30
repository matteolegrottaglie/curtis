// ============================================================
//  Fastify app: serve la dashboard + tutte le API REST.
// ============================================================
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { z } from 'zod';
import * as repo from '../db/repo.js';
import * as controller from '../safety/controller.js';
import { getDb } from '../db/index.js';
import { parseCsvBuffer } from '../importer/csv.js';
import { registerSse } from './sse.js';
import { appConfig } from '../config.js';
import { log } from '../util/log.js';
import type { Engine } from '../sequencer/engine.js';
import type { Step } from '../types.js';

// ---------------- schemi di validazione ----------------
const stepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('visit') }),
  z.object({ type: z.literal('connect'), note: z.string().max(300).optional() }),
  z.object({ type: z.literal('wait_accept'), maxDays: z.number().int().min(1).max(60) }),
  z.object({
    type: z.literal('wait'),
    days: z.number().int().min(0).max(60).optional(),
    hours: z.number().int().min(0).max(72).optional(),
  }),
  z.object({ type: z.literal('message'), text: z.string().min(1).max(1900) }),
  z.object({ type: z.literal('follow') }),
  z.object({ type: z.literal('like_recent'), count: z.number().int().min(1).max(5).optional() }),
]);

const rampSchema = z.object({ week: z.number().int().min(1), dailyInvites: z.number().int().min(0).max(100) });

const safetyConfigSchema = z
  .object({
    timezone: z.string().min(1),
    workingDays: z.array(z.number().int().min(1).max(7)).min(1),
    workStartHour: z.number().min(0).max(23),
    workEndHour: z.number().min(1).max(24),
    accountAgeDays: z.number().int().min(0).nullable(),
    connectionCount: z.number().int().min(0).nullable(),
    weeklyInviteCeiling: z.number().int().min(5).max(700),
    warmupStartDate: z.string().nullable(),
    rampStartWeekOffset: z.number().int().min(0).max(52),
    ramp: z.array(rampSchema).min(1),
    minAcceptanceRate: z.number().min(0).max(1),
    backoffFactor: z.number().min(0.1).max(0.99),
    recoveryStepPct: z.number().min(0.01).max(1),
    backoffCooldownHours: z.number().min(1).max(168),
    cleanDaysToRecover: z.number().int().min(1).max(30),
    caps: z.object({
      invites: z.number().int().min(0).max(100),
      messages: z.number().int().min(0).max(200),
      visits: z.number().int().min(0).max(300),
      follows: z.number().int().min(0).max(100),
      likes: z.number().int().min(0).max(200),
      withdraws: z.number().int().min(0).max(100),
    }),
    delays: z.object({
      betweenActionsMin: z.number().int().min(5_000),
      betweenActionsMax: z.number().int().min(10_000),
      longBreakEveryMin: z.number().int().min(1),
      longBreakEveryMax: z.number().int().min(1),
      longBreakMin: z.number().int().min(60_000),
      longBreakMax: z.number().int().min(60_000),
    }),
    sendNoteOnConnect: z.boolean(),
    autoWithdrawAfterDays: z.number().int().min(3).max(90),
    maxPendingBacklog: z.number().int().min(50).max(2000),
  })
  .refine((c) => c.workEndHour > c.workStartHour, { message: 'workEndHour deve essere > workStartHour' })
  .refine((c) => c.delays.betweenActionsMax >= c.delays.betweenActionsMin, {
    message: 'betweenActionsMax deve essere >= betweenActionsMin',
  });

const campaignSettingsSchema = z
  .object({
    // --- onorati per-campagna ---
    sendNoteOnConnect: z.boolean().optional(),
    caps: z
      .object({
        invites: z.number().int().min(0).optional(),
        messages: z.number().int().min(0).optional(),
        visits: z.number().int().min(0).optional(),
        follows: z.number().int().min(0).optional(),
        likes: z.number().int().min(0).optional(),
        withdraws: z.number().int().min(0).optional(),
      })
      .optional(),
    delays: z
      .object({
        betweenActionsMin: z.number().int().min(0).optional(),
        betweenActionsMax: z.number().int().min(0).optional(),
        longBreakEveryMin: z.number().int().min(0).optional(),
        longBreakEveryMax: z.number().int().min(0).optional(),
        longBreakMin: z.number().int().min(0).optional(),
        longBreakMax: z.number().int().min(0).optional(),
      })
      .optional(),
    // --- finestra oraria (onorata per-campagna come restrizione *aggiuntiva* alla globale) ---
    workingDays: z.array(z.number().int().min(1).max(7)).optional(),
    workStartHour: z.number().int().min(0).max(23).optional(),
    workEndHour: z.number().int().min(1).max(24).optional(),
    timezone: z.string().optional(),
    // --- snapshot informativo: salvato ma l'engine usa il valore globale a runtime ---
    weeklyInviteCeiling: z.number().int().min(5).optional(),
    rampStartWeekOffset: z.number().int().min(0).optional(),
    minAcceptanceRate: z.number().min(0).max(1).optional(),
    backoffFactor: z.number().min(0.1).max(1).optional(),
    recoveryStepPct: z.number().min(0.01).max(1).optional(),
    backoffCooldownHours: z.number().int().min(1).optional(),
    cleanDaysToRecover: z.number().int().min(1).optional(),
    autoWithdrawAfterDays: z.number().int().min(3).optional(),
    maxPendingBacklog: z.number().int().min(50).optional(),
    ramp: z
      .array(z.object({ week: z.number().int().min(1), dailyInvites: z.number().int().min(0) }))
      .optional(),
  })
  .optional();

const campaignCreateSchema = z.object({
  name: z.string().min(1).max(120),
  steps: z.array(stepSchema).min(1),
  settings: campaignSettingsSchema,
});

const importSchema = z.object({ filename: z.string().min(1), content: z.string().min(1) });
const deleteContactsSchema = z.object({
  ids: z.array(z.string()).max(100000),
  onlyUnenrolled: z.boolean().optional(),
});
const enrollSchema = z.object({ all: z.boolean().optional(), contactIds: z.array(z.string()).optional() });

export function buildApp(engine: Engine): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });

  // static: dashboard
  app.register(fastifyStatic, { root: join(process.cwd(), 'public'), prefix: '/' });
  // static: screenshot (per ispezionare i fallimenti)
  app.register(fastifyStatic, {
    root: join(appConfig.dataDir, 'screenshots'),
    prefix: '/screenshots/',
    decorateReply: false,
  });

  registerSse(app);

  // ---------------- engine / status ----------------
  app.get('/api/status', async () => engine.status());
  app.get('/api/overview', async () => ({
    contacts: repo.countContacts(),
    campaigns: repo.listCampaigns().length,
    engine: engine.status(),
  }));

  app.post('/api/engine/start', async () => {
    await engine.start();
    return engine.status();
  });
  app.post('/api/engine/stop', async () => {
    await engine.stop();
    return engine.status();
  });
  app.post('/api/engine/pause', async () => {
    engine.pause();
    return engine.status();
  });
  app.post('/api/engine/resume', async () => {
    engine.resume();
    return engine.status();
  });
  app.post('/api/engine/clear-halt', async () => {
    controller.clearHalt();
    return engine.status();
  });

  // ---------------- auth (tab Account) ----------------
  app.get('/api/auth/status', async () => engine.authStatus());
  app.post('/api/auth/open', async () => engine.openLogin());
  app.post('/api/auth/logout', async (_req, reply) => {
    try {
      return await engine.logout();
    } catch (e) {
      return reply.code(409).send({ error: String(e) });
    }
  });

  // ---------------- settings ----------------
  app.get('/api/settings', async () => repo.getSafetyConfig());
  app.put('/api/settings', async (req, reply) => {
    const parsed = safetyConfigSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    repo.saveSafetyConfig(parsed.data);
    return repo.getSafetyConfig();
  });

  // ---------------- contacts ----------------
  app.get('/api/contacts', async (req) => {
    const q = req.query as { search?: string; limit?: string; offset?: string };
    const limit = Math.min(500, Number(q.limit ?? 100));
    const offset = Number(q.offset ?? 0);
    return {
      total: repo.countContacts(),
      contacts: repo.listContacts({ search: q.search, limit, offset }),
    };
  });

  app.post('/api/import', async (req, reply) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const result = parseCsvBuffer(parsed.data.content, parsed.data.filename);
    const { inserted, skipped, ids } = repo.upsertContacts(result.valid);
    // Oggetti contatto (slim) del file → preview "uno a uno" nel wizard.
    const contacts = repo.getContactsByIds(ids).map((c) => ({
      id: c.id,
      full_name: c.full_name,
      first_name: c.first_name,
      last_name: c.last_name,
      company: c.company,
      profile_url: c.profile_url,
    }));
    return {
      total: result.total,
      validRows: result.valid.length,
      inserted,
      duplicates: skipped,
      invalidRows: result.invalid.length,
      invalidSample: result.invalid.slice(0, 10),
      // ID + oggetti di TUTTI i contatti del file (inseriti + duplicati): per "annulla import" e preview.
      contactIds: ids,
      contacts,
    };
  });

  // Cancella contatti per ID (usato da "annulla import"). onlyUnenrolled protegge i contatti
  // già iscritti ad altre campagne. Iscrizioni dei rimossi → cascade; righe in `actions` restano.
  app.post('/api/contacts/delete', async (req, reply) => {
    const parsed = deleteContactsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const n = repo.deleteContactsByIds(parsed.data.ids, parsed.data.onlyUnenrolled ?? false);
    return { deleted: n };
  });

  // ---------------- campaigns ----------------
  app.get('/api/campaigns', async () =>
    repo.listCampaigns().map((c) => ({
      ...c,
      steps: JSON.parse(c.steps) as Step[],
      counts: repo.enrollmentStatusCounts(c.id),
    })),
  );

  app.post('/api/campaigns', async (req, reply) => {
    const parsed = campaignCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const c = repo.createCampaign(parsed.data.name, parsed.data.steps, parsed.data.settings);
    return { ...c, steps: JSON.parse(c.steps) as Step[], counts: {} };
  });

  app.get('/api/campaigns/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = repo.getCampaign(id);
    if (!c) return reply.code(404).send({ error: 'campagna non trovata' });
    return { ...c, steps: JSON.parse(c.steps) as Step[], counts: repo.enrollmentStatusCounts(id) };
  });

  app.put('/api/campaigns/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = campaignCreateSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    repo.updateCampaign(id, parsed.data);
    const c = repo.getCampaign(id)!;
    return { ...c, steps: JSON.parse(c.steps) as Step[], counts: repo.enrollmentStatusCounts(id) };
  });

  app.post('/api/campaigns/:id/status', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ status: z.enum(['draft', 'running', 'paused', 'archived']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues });
    repo.setCampaignStatus(id, body.data.status);
    return repo.getCampaign(id);
  });

  app.delete('/api/campaigns/:id', async (req) => {
    const { id } = req.params as { id: string };
    repo.deleteCampaign(id);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/enroll', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    let ids = parsed.data.contactIds ?? [];
    if (parsed.data.all) {
      ids = (getDb().prepare('SELECT id FROM contacts').all() as { id: string }[]).map((r) => r.id);
    }
    const n = repo.enrollContacts(id, ids);
    return { enrolled: n, requested: ids.length };
  });

  // ---------------- metrics (pagina Account) ----------------
  app.get('/api/metrics', async () => {
    const cfg = repo.getSafetyConfig();
    const tz = cfg.timezone;
    const now = Date.now();
    const dayMs = 86_400_000;
    const { DateTime } = await import('luxon');

    // Crea N giorni "scaffold" (ordinati dal più vecchio al più recente) nel TZ giusto.
    const dayKeys = (n: number): string[] => {
      const today = DateTime.now().setZone(tz).startOf('day');
      const out: string[] = [];
      for (let i = n - 1; i >= 0; i--) out.push(today.minus({ days: i }).toISODate()!);
      return out;
    };
    const dayKeyOf = (atMs: number) => DateTime.fromMillis(atMs).setZone(tz).toISODate()!;

    // -- Chart 1: invii (e accettazioni) per giorno · ultimi 14 giorni
    const days14 = dayKeys(14);
    const since14 = now - 14 * dayMs;
    const sent14 = repo.actionTimestamps('connect', 'success', since14);
    const accepted14 = repo.actionTimestamps('check_accepted', 'success', since14);
    const sentByDay = new Map(days14.map((d) => [d, 0]));
    const accByDay = new Map(days14.map((d) => [d, 0]));
    for (const t of sent14) {
      const k = dayKeyOf(t);
      if (sentByDay.has(k)) sentByDay.set(k, sentByDay.get(k)! + 1);
    }
    for (const t of accepted14) {
      const k = dayKeyOf(t);
      if (accByDay.has(k)) accByDay.set(k, accByDay.get(k)! + 1);
    }
    const dailyInvites = days14.map((d) => ({ date: d, sent: sentByDay.get(d)!, accepted: accByDay.get(d)! }));

    // -- Chart 2: acceptance rate · rolling 7d sugli ultimi 30 giorni
    const since37 = now - 37 * dayMs;
    const sent37 = repo.actionTimestamps('connect', 'success', since37);
    const acc37 = repo.actionTimestamps('check_accepted', 'success', since37);
    const days30 = dayKeys(30);
    const dailyAcceptance = days30.map((d) => {
      const end = DateTime.fromISO(d, { zone: tz }).endOf('day').toMillis();
      const start = DateTime.fromISO(d, { zone: tz }).minus({ days: 6 }).startOf('day').toMillis();
      const s = sent37.filter((t) => t >= start && t <= end).length;
      const a = acc37.filter((t) => t >= start && t <= end).length;
      return { date: d, rate: s > 0 ? a / s : null };
    });

    // -- Funnel · ultimi 30 giorni
    const since30 = now - 30 * dayMs;
    const funnel = {
      visits: repo.countActions({ type: 'visit', status: 'success', since: since30 }),
      invitesSent: repo.countActions({ type: 'connect', status: 'success', since: since30 }),
      accepted: repo.countActions({ type: 'check_accepted', status: 'success', since: since30 }),
      messages: repo.countActions({ type: 'message', status: 'success', since: since30 }),
    };

    // -- Stato campagne (aggregato)
    const camps = repo.listCampaigns();
    const campaigns = { total: camps.length, draft: 0, running: 0, paused: 0, archived: 0 };
    for (const c of camps) {
      const s = c.status as 'draft' | 'running' | 'paused' | 'archived';
      if (s in campaigns) (campaigns as Record<string, number>)[s]++;
    }

    // -- Segnali · ultimi 7 giorni (salute account)
    const signalRows = repo.recentSignals(now - 7 * dayMs);
    const signals = {
      total: signalRows.length,
      captcha: signalRows.filter((s) => s.kind === 'captcha').length,
      warning: signalRows.filter((s) => s.kind === 'warning').length,
      weeklyLimit: signalRows.filter((s) => s.kind === 'weekly_limit').length,
      restriction: signalRows.filter((s) => s.kind === 'restriction').length,
      error: signalRows.filter((s) => s.kind === 'error').length,
      lastAt: signalRows[0]?.created_at ?? null,
    };

    return { dailyInvites, dailyAcceptance, funnel, campaigns, signals, generatedAt: now };
  });

  // ---------------- log / segnali ----------------
  app.get('/api/actions', async (req) => {
    const q = req.query as { limit?: string };
    return repo.recentActions(Math.min(200, Number(q.limit ?? 80)));
  });
  app.get('/api/signals', async (req) => {
    const q = req.query as { days?: string };
    const days = Number(q.days ?? 7);
    return repo.recentSignals(Date.now() - days * 86_400_000);
  });

  app.setErrorHandler((err, _req, reply) => {
    log.error({ err: String(err) }, 'errore API');
    reply.code(500).send({ error: String(err) });
  });

  return app;
}
