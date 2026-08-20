// ============================================================
//  Metrics meant to be read from chat: invite trend, acceptance rate,
//  funnel, campaign status, account health signals.
//
//  Logic lifted verbatim from the /api/metrics endpoint of the old
//  dashboard.
// ============================================================
import { DateTime } from 'luxon';
import * as repo from '../db/repo.js';

const DAY_MS = 86_400_000;

export interface Metrics {
  daily_invites: { date: string; sent: number; accepted: number }[];
  daily_acceptance: { date: string; rate: number | null }[];
  funnel_30d: { visits: number; invites_sent: number; accepted: number; messages: number };
  campaigns: { total: number; draft: number; running: number; paused: number; archived: number };
  signals_7d: {
    total: number;
    captcha: number;
    warning: number;
    weekly_limit: number;
    restriction: number;
    error: number;
    last_at: number | null;
  };
  generated_at: number;
}

export function getMetrics(at: number = Date.now()): Metrics {
  const tz = repo.getSafetyConfig().timezone;

  // "Scaffold" days in the configured timezone, oldest to newest.
  const dayKeys = (n: number): string[] => {
    const today = DateTime.fromMillis(at).setZone(tz).startOf('day');
    const out: string[] = [];
    for (let i = n - 1; i >= 0; i--) out.push(today.minus({ days: i }).toISODate()!);
    return out;
  };
  const dayKeyOf = (ms: number) => DateTime.fromMillis(ms).setZone(tz).toISODate()!;

  // -- invites (and acceptances) per day · last 14 days
  const days14 = dayKeys(14);
  const since14 = at - 14 * DAY_MS;
  const sentByDay = new Map(days14.map((d) => [d, 0]));
  const accByDay = new Map(days14.map((d) => [d, 0]));
  for (const t of repo.actionTimestamps('connect', 'success', since14)) {
    const k = dayKeyOf(t);
    if (sentByDay.has(k)) sentByDay.set(k, sentByDay.get(k)! + 1);
  }
  for (const t of repo.actionTimestamps('check_accepted', 'success', since14)) {
    const k = dayKeyOf(t);
    if (accByDay.has(k)) accByDay.set(k, accByDay.get(k)! + 1);
  }
  const daily_invites = days14.map((d) => ({ date: d, sent: sentByDay.get(d)!, accepted: accByDay.get(d)! }));

  // -- acceptance rate · 7-day rolling window over the last 30
  const since37 = at - 37 * DAY_MS;
  const sent37 = repo.actionTimestamps('connect', 'success', since37);
  const acc37 = repo.actionTimestamps('check_accepted', 'success', since37);
  const daily_acceptance = dayKeys(30).map((d) => {
    const end = DateTime.fromISO(d, { zone: tz }).endOf('day').toMillis();
    const start = DateTime.fromISO(d, { zone: tz }).minus({ days: 6 }).startOf('day').toMillis();
    const s = sent37.filter((t) => t >= start && t <= end).length;
    const a = acc37.filter((t) => t >= start && t <= end).length;
    return { date: d, rate: s > 0 ? a / s : null };
  });

  // -- funnel · last 30 days
  const since30 = at - 30 * DAY_MS;
  const funnel_30d = {
    visits: repo.countActions({ type: 'visit', status: 'success', since: since30 }),
    invites_sent: repo.countActions({ type: 'connect', status: 'success', since: since30 }),
    accepted: repo.countActions({ type: 'check_accepted', status: 'success', since: since30 }),
    messages: repo.countActions({ type: 'message', status: 'success', since: since30 }),
  };

  // -- campaign status
  const campaigns = { total: 0, draft: 0, running: 0, paused: 0, archived: 0 };
  for (const c of repo.listCampaigns()) {
    campaigns.total++;
    if (c.status in campaigns) (campaigns as Record<string, number>)[c.status]!++;
  }

  // -- signals · last 7 days
  const rows = repo.recentSignals(at - 7 * DAY_MS);
  const signals_7d = {
    total: rows.length,
    captcha: rows.filter((s) => s.kind === 'captcha').length,
    warning: rows.filter((s) => s.kind === 'warning').length,
    weekly_limit: rows.filter((s) => s.kind === 'weekly_limit').length,
    restriction: rows.filter((s) => s.kind === 'restriction').length,
    error: rows.filter((s) => s.kind === 'error').length,
    last_at: rows[0]?.created_at ?? null,
  };

  return { daily_invites, daily_acceptance, funnel_30d, campaigns, signals_7d, generated_at: at };
}
