// ============================================================
//  Tool di lettura: metriche, log delle azioni, segnali di salute.
// ============================================================
import { z } from 'zod';
import type { MCPServer } from 'mcp-use';
import * as repo from '../../db/repo.js';
import { getMetrics } from '../../service/metrics.js';
import { textBlock } from '../result.js';

export function registerInsightTools(server: MCPServer): void {
  server.tool(
    {
      name: 'get_metrics',
      title: 'Metriche di outreach',
      description:
        'Andamento degli invii e delle accettazioni per giorno (14 giorni), acceptance rate a finestra mobile 7 giorni (30 giorni), funnel visite → inviti → accettati → messaggi (30 giorni), stato delle campagne e segnali di salute dell\'account (7 giorni). L\'acceptance rate è il numero che conta: se scende, il problema è il targeting o il messaggio, non i limiti.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        daily_invites: z.array(z.object({ date: z.string(), sent: z.number(), accepted: z.number() })),
        daily_acceptance: z.array(z.object({ date: z.string(), rate: z.number().nullable() })),
        funnel_30d: z.object({
          visits: z.number(),
          invites_sent: z.number(),
          accepted: z.number(),
          messages: z.number(),
        }),
        campaigns: z.object({
          total: z.number(),
          draft: z.number(),
          running: z.number(),
          paused: z.number(),
          archived: z.number(),
        }),
        signals_7d: z.object({
          total: z.number(),
          captcha: z.number(),
          warning: z.number(),
          weekly_limit: z.number(),
          restriction: z.number(),
          error: z.number(),
          last_at: z.number().nullable(),
        }),
        generated_at: z.number(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const m = getMetrics();
      const f = m.funnel_30d;
      const lastRate = [...m.daily_acceptance].reverse().find((d) => d.rate !== null)?.rate ?? null;
      const text = [
        `Ultimi 30 giorni: ${f.visits} visite, ${f.invites_sent} inviti, ${f.accepted} accettati, ${f.messages} messaggi.`,
        lastRate === null ? 'Acceptance rate non ancora misurabile.' : `Acceptance rate (7gg mobile): ${Math.round(lastRate * 100)}%.`,
        m.signals_7d.total > 0
          ? `⚠ ${m.signals_7d.total} segnali negli ultimi 7 giorni (captcha ${m.signals_7d.captcha}, limiti ${m.signals_7d.weekly_limit}, restrizioni ${m.signals_7d.restriction}).`
          : 'Nessun segnale negativo negli ultimi 7 giorni.',
      ].join(' ');
      return { content: [textBlock(text)], structuredContent: m };
    },
  );

  server.tool(
    {
      name: 'get_recent_actions',
      title: 'Ultime azioni eseguite',
      description:
        'Log delle ultime azioni del motore, con esito e dettaglio. Quando un\'azione fallisce per un selettore che LinkedIn ha cambiato, il campo screenshot contiene il percorso di uno screenshot da guardare.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).optional().describe('Default 20'),
      }),
      outputSchema: z.object({
        actions: z.array(
          z.object({
            type: z.string(),
            status: z.string(),
            detail: z.string().nullable(),
            contact_name: z.string().nullable(),
            contact_url: z.string().nullable(),
            screenshot: z.string().nullable(),
            created_at: z.number(),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ limit }) => {
      const rows = repo.recentActions(limit ?? 20).map((a) => ({
        type: a.type as string,
        status: a.status as string,
        detail: a.detail,
        contact_name: a.contact_name,
        contact_url: a.contact_url,
        screenshot: a.screenshot,
        created_at: a.created_at,
      }));
      const text = rows.length
        ? rows
            .map(
              (a) =>
                `${new Date(a.created_at).toLocaleString('it-IT')} · ${a.type} · ${a.status}${a.contact_name ? ` · ${a.contact_name}` : ''}${a.detail ? ` — ${a.detail}` : ''}`,
            )
            .join('\n')
        : 'Nessuna azione registrata.';
      return { content: [textBlock(text)], structuredContent: { actions: rows } };
    },
  );

  server.tool(
    {
      name: 'get_signals',
      title: 'Segnali di salute dell\'account',
      description:
        'Segnali rilevati su LinkedIn: limite settimanale, captcha o verifica di sicurezza, restrizione dell\'account, avvisi di attività insolita. Sono la ragione per cui il motore rallenta o si ferma.',
      inputSchema: z.object({
        days: z.number().int().min(1).max(90).optional().describe('Finestra in giorni, default 7'),
      }),
      outputSchema: z.object({
        signals: z.array(
          z.object({
            kind: z.string(),
            severity: z.number(),
            detail: z.string().nullable(),
            created_at: z.number(),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ days }) => {
      const since = Date.now() - (days ?? 7) * 86_400_000;
      const rows = repo.recentSignals(since).map((s) => ({
        kind: s.kind as string,
        severity: s.severity,
        detail: s.detail,
        created_at: s.created_at,
      }));
      const text = rows.length
        ? rows
            .map((s) => `${new Date(s.created_at).toLocaleString('it-IT')} · ${s.kind} (gravità ${s.severity})${s.detail ? ` — ${s.detail}` : ''}`)
            .join('\n')
        : `Nessun segnale negli ultimi ${days ?? 7} giorni: l'account è tranquillo.`;
      return { content: [textBlock(text)], structuredContent: { signals: rows } };
    },
  );
}
