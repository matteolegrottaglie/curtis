// ============================================================
//  Tool di controllo del motore: stato e comandi.
// ============================================================
import { z } from 'zod';
import type { MCPServer } from 'mcp-use';
import type { Engine } from '../../sequencer/engine.js';
import * as controller from '../../safety/controller.js';
import { errorResult, fromException, textBlock } from '../result.js';

const engineStatusSchema = z.object({
  running: z.boolean().describe('Il worker loop è attivo'),
  paused: z.boolean().describe('Pausa manuale'),
  halted: z.boolean().describe('Stop di sicurezza: serve intervento umano su LinkedIn'),
  halted_reason: z.string().nullable(),
  in_working_window: z.boolean().describe('Siamo dentro la finestra di giorni/orari configurata'),
  backoff_until: z.number().nullable().describe('Epoch ms fino a cui gli inviti sono sospesi'),
  daily_invite_target: z.number().describe('Inviti previsti oggi dalla rampa, già corretti dal controller'),
  weekly_ceiling: z.number().describe('Tetto settimanale adattivo attualmente in vigore'),
  invites_today: z.number(),
  invites_last_7_days: z.number(),
  pending_invites: z.number().describe('Inviti inviati e non ancora accettati'),
  acceptance_rate_30d: z.number().nullable(),
  logged_in: z.boolean(),
  account: z.string().nullable(),
  note: z.string().describe('Cosa sta facendo adesso il motore'),
});

function summarize(s: Record<string, unknown>): string {
  const lines: string[] = [];
  if (s.halted) lines.push(`⛔ HALT: ${s.halted_reason}. Risolvi la segnalazione su LinkedIn, poi engine_control action="clear_halt".`);
  else if (!s.running) lines.push('Motore fermo.');
  else if (s.paused) lines.push('Motore in pausa.');
  else if (!s.in_working_window) lines.push('Motore attivo ma fuori dalla finestra oraria configurata: riprenderà da solo.');
  else lines.push(`Motore attivo — ${String(s.note ?? '')}`);
  lines.push(
    `Inviti oggi ${s.invites_today}/${s.daily_invite_target}, ultimi 7 giorni ${s.invites_last_7_days}/${s.weekly_ceiling}, pendenti ${s.pending_invites}.`,
  );
  const acc = s.acceptance_rate_30d as number | null;
  lines.push(acc === null ? 'Acceptance rate: non ancora misurabile.' : `Acceptance rate 30 giorni: ${Math.round(acc * 100)}%.`);
  return lines.join(' ');
}

export function registerEngineTools(server: MCPServer, engine: Engine): void {
  const readStatus = async () => {
    const s = engine.status();
    const auth = await engine.authStatus();
    return {
      running: s.running,
      paused: s.paused,
      halted: s.halted,
      halted_reason: s.haltedReason,
      in_working_window: s.inWindow,
      backoff_until: s.backoffUntil,
      daily_invite_target: s.dailyTarget,
      weekly_ceiling: s.weeklyCeiling,
      invites_today: s.invitesToday,
      invites_last_7_days: s.invitesThisWeek,
      pending_invites: s.pending,
      acceptance_rate_30d: s.acceptance,
      logged_in: auth.loggedIn,
      account: auth.account,
      note: s.note,
    };
  };

  server.tool(
    {
      name: 'engine_status',
      title: 'Stato del motore',
      description:
        'Fotografia completa: motore attivo o fermo, halt di sicurezza, finestra oraria, limiti in vigore, inviti di oggi e della settimana, inviti pendenti, acceptance rate. Usalo per rispondere a "come sta andando?".',
      inputSchema: z.object({}),
      outputSchema: engineStatusSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => {
      const data = await readStatus();
      return { content: [textBlock(summarize(data))], structuredContent: data };
    },
  );

  server.tool(
    {
      name: 'engine_control',
      title: 'Comanda il motore',
      description:
        'start: apre il browser e comincia a lavorare sulle campagne in stato "running" (rispettando finestra oraria, rampa e tetti). stop: ferma il loop e chiude il browser. pause / resume: sospensione manuale senza chiudere il browser. clear_halt: azzera uno stop di sicurezza — fallo SOLO dopo che l\'utente ha risolto la segnalazione su LinkedIn (captcha, verifica, restrizione), altrimenti si riparte dritti nel problema.',
      inputSchema: z.object({
        action: z.enum(['start', 'stop', 'pause', 'resume', 'clear_halt']),
      }),
      outputSchema: engineStatusSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ action }) => {
      try {
        switch (action) {
          case 'start': {
            const st = engine.status();
            if (st.halted) {
              return errorResult(
                `Non avvio: c'è uno stop di sicurezza attivo (${st.haltedReason}). Risolvi su LinkedIn, poi usa clear_halt.`,
              );
            }
            const auth = await engine.authStatus();
            if (!auth.loggedIn) {
              return errorResult('Non avvio: sessione LinkedIn assente. Usa prima linkedin_login.');
            }
            await engine.start();
            break;
          }
          case 'stop':
            await engine.stop();
            break;
          case 'pause':
            engine.pause();
            break;
          case 'resume':
            engine.resume();
            break;
          case 'clear_halt':
            controller.clearHalt();
            break;
        }
        const data = await readStatus();
        return { content: [textBlock(`Comando "${action}" eseguito. ${summarize(data)}`)], structuredContent: data };
      } catch (err) {
        return fromException(err, `Comando "${action}" non riuscito`);
      }
    },
  );
}
