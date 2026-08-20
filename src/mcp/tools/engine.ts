// ============================================================
//  Engine control tools: status and commands.
// ============================================================
import { z } from 'zod';
import type { MCPServer } from 'mcp-use';
import type { Engine } from '../../sequencer/engine.js';
import * as controller from '../../safety/controller.js';
import { errorResult, fromException, textBlock } from '../result.js';

const engineStatusSchema = z.object({
  running: z.boolean().describe('The worker loop is active'),
  paused: z.boolean().describe('Manual pause'),
  halted: z.boolean().describe('Safety stop: a human has to deal with something on LinkedIn'),
  halted_reason: z.string().nullable(),
  in_working_window: z.boolean().describe('We are inside the configured days/hours window'),
  backoff_until: z.number().nullable().describe('Epoch ms until which invitations are suspended'),
  daily_invite_target: z.number().describe('Invitations planned for today by the ramp, already adjusted by the controller'),
  weekly_ceiling: z.number().describe('Adaptive weekly ceiling currently in force'),
  invites_today: z.number(),
  invites_last_7_days: z.number(),
  pending_invites: z.number().describe('Invitations sent and not yet accepted'),
  acceptance_rate_30d: z.number().nullable(),
  logged_in: z.boolean(),
  account: z.string().nullable(),
  note: z.string().describe('What the engine is doing right now'),
});

function summarize(s: Record<string, unknown>): string {
  const lines: string[] = [];
  if (s.halted) lines.push(`⛔ HALT: ${s.halted_reason}. Clear the flag on LinkedIn, then engine_control action="clear_halt".`);
  else if (!s.running) lines.push('Engine stopped.');
  else if (s.paused) lines.push('Engine paused.');
  else if (!s.in_working_window) lines.push('Engine active but outside the configured working window: it will resume on its own.');
  else lines.push(`Engine active — ${String(s.note ?? '')}`);
  lines.push(
    `Invitations today ${s.invites_today}/${s.daily_invite_target}, last 7 days ${s.invites_last_7_days}/${s.weekly_ceiling}, pending ${s.pending_invites}.`,
  );
  const acc = s.acceptance_rate_30d as number | null;
  lines.push(acc === null ? 'Acceptance rate: not measurable yet.' : `Acceptance rate over 30 days: ${Math.round(acc * 100)}%.`);
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
      title: 'Engine status',
      description:
        'The full picture: engine running or stopped, safety halts, working window, limits in force, invitations sent today and this week, pending invitations, acceptance rate. Use it to answer "how is it going?".',
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
      title: 'Command the engine',
      description:
        'start: opens the browser and begins working through the campaigns in "running" state (respecting the working window, the ramp and the ceilings). stop: halts the loop and closes the browser. pause / resume: manual suspension without closing the browser. clear_halt: clears a safety stop — do this ONLY after the user has dealt with the flag on LinkedIn (captcha, verification, restriction), otherwise you walk straight back into the problem.',
      inputSchema: z.object({
        action: z.enum(['start', 'stop', 'pause', 'resume', 'clear_halt']),
      }),
      outputSchema: engineStatusSchema,
      // destructiveHint: "start" fires real invitations at real people.
      // Withdrawing an invitation does not undo it: LinkedIn blocks re-inviting
      // the same person for ~3 weeks. The client must ask for confirmation.
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ action }) => {
      try {
        switch (action) {
          case 'start': {
            const st = engine.status();
            if (st.halted) {
              return errorResult(
                `Not starting: a safety stop is active (${st.haltedReason}). Sort it out on LinkedIn, then use clear_halt.`,
              );
            }
            const auth = await engine.authStatus();
            if (!auth.loggedIn) {
              return errorResult('Not starting: no LinkedIn session. Use linkedin_login first.');
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
        return { content: [textBlock(`Command "${action}" executed. ${summarize(data)}`)], structuredContent: data };
      } catch (err) {
        return fromException(err, `Command "${action}" failed`);
      }
    },
  );
}
