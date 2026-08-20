// ============================================================
//  Tool sulle impostazioni di sicurezza (rampa, tetti, ritardi).
// ============================================================
import { z } from 'zod';
import type { MCPServer } from 'mcp-use';
import * as safety from '../../service/safety.js';
import { safetyConfigPatchSchema } from '../schemas.js';
import { fromException, textBlock } from '../result.js';
import type { SafetyConfig } from '../../types.js';

// La config viaggia come oggetto libero: la forma esatta è già garantita
// dalla validazione zod lato servizio, e ripeterla qui la renderebbe fragile.
const safetyOutput = z.object({
  settings: z.record(z.string(), z.unknown()),
  summary: z.string(),
});

function summarize(c: SafetyConfig): string {
  const days = c.workingDays.join(',');
  return [
    `Finestra: giorni ${days}, ${c.workStartHour}:00–${c.workEndHour}:00 (${c.timezone}).`,
    `Tetto settimanale inviti ${c.weeklyInviteCeiling}, cap giornalieri: inviti ${c.caps.invites}, messaggi ${c.caps.messages}, visite ${c.caps.visits}.`,
    `Rampa: ${c.ramp.map((r) => `sett.${r.week}→${r.dailyInvites}/g`).join(', ')}.`,
    `Ritardo fra azioni ${Math.round(c.delays.betweenActionsMin / 1000)}–${Math.round(c.delays.betweenActionsMax / 1000)}s.`,
    `Nota sull'invito: ${c.sendNoteOnConnect ? 'ATTIVA' : 'disattivata'}. Soglia acceptance ${Math.round(c.minAcceptanceRate * 100)}%.`,
  ].join(' ');
}

export function registerSafetyTools(server: MCPServer): void {
  server.tool(
    {
      name: 'get_safety_settings',
      title: 'Leggi le impostazioni di sicurezza',
      description:
        'Restituisce rampa di warm-up, tetti giornalieri e settimanali, finestra oraria, ritardi fra le azioni e soglie del controller adattivo.',
      inputSchema: z.object({}),
      outputSchema: safetyOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const c = safety.getSafetySettings();
      const summary = summarize(c);
      return {
        content: [textBlock(summary)],
        structuredContent: { settings: c as unknown as Record<string, unknown>, summary },
      };
    },
  );

  server.tool(
    {
      name: 'update_safety_settings',
      title: 'Modifica le impostazioni di sicurezza',
      description:
        "Aggiorna solo i campi che passi; il resto resta com'è. ATTENZIONE: alzare weeklyInviteCeiling, i caps o accorciare i delays aumenta concretamente il rischio di restrizione dell'account. Prima di alzarli, dillo esplicitamente all'utente e chiedi conferma. Abbassarli è sempre sicuro.",
      inputSchema: safetyConfigPatchSchema,
      outputSchema: safetyOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (patch) => {
      try {
        const c = safety.updateSafetySettings(patch);
        const summary = summarize(c);
        return {
          content: [textBlock(`Impostazioni aggiornate. ${summary}`)],
          structuredContent: { settings: c as unknown as Record<string, unknown>, summary },
        };
      } catch (err) {
        return fromException(err, 'Aggiornamento non riuscito');
      }
    },
  );
}
