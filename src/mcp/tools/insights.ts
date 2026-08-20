// ============================================================
//  Read-only tools: metrics, action log, health signals.
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
      title: 'Outreach metrics',
      description:
        'Invitations sent and accepted per day (14 days), acceptance rate over a 7-day rolling window (30 days), funnel visits → invitations → accepted → messages (30 days), campaign states and account health signals (7 days). The acceptance rate is the number that matters: if it drops, the problem is the targeting or the message, not the limits.',
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
        `Last 30 days: ${f.visits} visits, ${f.invites_sent} invitations, ${f.accepted} accepted, ${f.messages} messages.`,
        lastRate === null ? 'Acceptance rate not measurable yet.' : `Acceptance rate (7-day rolling): ${Math.round(lastRate * 100)}%.`,
        m.signals_7d.total > 0
          ? `⚠ ${m.signals_7d.total} signals in the last 7 days (captcha ${m.signals_7d.captcha}, limits ${m.signals_7d.weekly_limit}, restrictions ${m.signals_7d.restriction}).`
          : 'No negative signals in the last 7 days.',
      ].join(' ');
      return { content: [textBlock(text)], structuredContent: m };
    },
  );

  server.tool(
    {
      name: 'get_recent_actions',
      title: 'Most recent actions',
      description:
        'Log of the engine\'s most recent actions, with outcome and detail. When an action fails on a selector LinkedIn has changed, the screenshot field holds the path to a screenshot worth looking at.',
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
        : 'No actions recorded.';
      return { content: [textBlock(text)], structuredContent: { actions: rows } };
    },
  );

  server.tool(
    {
      name: 'get_signals',
      title: 'Account health signals',
      description:
        'Signals picked up on LinkedIn: weekly limit reached, captcha or security check, account restriction, unusual-activity warnings. They are the reason the engine slows down or stops.',
      inputSchema: z.object({
        days: z.number().int().min(1).max(90).optional().describe('Window in days, default 7'),
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
            .map((s) => `${new Date(s.created_at).toLocaleString('it-IT')} · ${s.kind} (severity ${s.severity})${s.detail ? ` — ${s.detail}` : ''}`)
            .join('\n')
        : `No signals in the last ${days ?? 7} days: the account is quiet.`;
      return { content: [textBlock(text)], structuredContent: { signals: rows } };
    },
  );
}
