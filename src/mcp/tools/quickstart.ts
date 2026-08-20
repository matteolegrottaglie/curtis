// ============================================================
//  Percorso rapido: dalla lista di contatti agli inviti in partenza
//  con una sola chiamata.
//
//  È il caso d'uso principale del prodotto: "ecco il mio CSV,
//  comincia a mandare le richieste di collegamento".
// ============================================================
import { z } from 'zod';
import type { MCPServer } from 'mcp-use';
import type { Engine } from '../../sequencer/engine.js';
import * as contacts from '../../service/contacts.js';
import * as campaigns from '../../service/campaigns.js';
import * as safety from '../../service/safety.js';
import { errorResult, fromException, textBlock } from '../result.js';
import type { CampaignOverrides } from '../../types.js';

export function registerQuickstartTools(server: MCPServer, engine: Engine): void {
  server.tool(
    {
      name: 'start_connection_campaign',
      title: 'Avvia una campagna di collegamenti da una lista',
      description:
        "Il percorso completo in un colpo solo: importa la lista di contatti, crea una campagna con la sequenza sicura consigliata (visita → attesa 1 giorno → collegamento senza nota → attesa accettazione → primo messaggio opzionale), iscrive tutti i contatti importati, mette la campagna in esecuzione e avvia il motore. Richiede una sessione LinkedIn già attiva. Il motore lavora lentamente e solo dentro la finestra oraria configurata: è voluto, la lentezza è la protezione.",
      inputSchema: z.object({
        file_path: z.string().optional().describe('Percorso del CSV con i contatti'),
        csv_content: z.string().optional().describe('Contenuto CSV incollato (alternativa a file_path)'),
        campaign_name: z.string().min(1).max(120).optional().describe('Default: nome del file + data'),
        first_message: z
          .string()
          .max(1900)
          .optional()
          .describe(
            'Messaggio inviato dopo che l\'invito è stato accettato. È qui che va la personalizzazione. Placeholder: {firstName}, {company}, … Spintax: {Ciao|Salve}.',
          ),
        wait_accept_days: z.number().int().min(1).max(60).optional().describe('Default 14'),
        daily_invite_cap: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Tetto di inviti al giorno per questa campagna. Se omesso vale la rampa globale.'),
        start_engine: z
          .boolean()
          .optional()
          .describe('Default true. Con false prepara tutto ma non fa partire il motore.'),
      }),
      outputSchema: z.object({
        campaign_id: z.string(),
        campaign_name: z.string(),
        import_id: z.string(),
        contacts_imported: z.number(),
        contacts_enrolled: z.number(),
        rows_invalid: z.number(),
        rows_url_inferred: z.number(),
        engine_running: z.boolean(),
        daily_invite_target: z.number(),
        weekly_ceiling: z.number(),
        working_window: z.string(),
        next_steps: z.string(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (input) => {
      try {
        const auth = await engine.authStatus();
        if (!auth.loggedIn) {
          return errorResult(
            'Nessuna sessione LinkedIn attiva. Esegui prima linkedin_login: si aprirà una finestra del browser in cui accedere a mano.',
          );
        }
        if (!input.file_path && !input.csv_content) {
          return errorResult('Serve `file_path` (percorso del CSV) oppure `csv_content` (CSV incollato).');
        }

        const imported = contacts.importContacts({
          ...(input.file_path ? { filePath: input.file_path } : {}),
          ...(input.csv_content ? { csvContent: input.csv_content } : {}),
          previewLimit: 3,
        });
        if (imported.contact_count === 0) {
          return errorResult(
            `Nessun contatto utilizzabile nel file: ${imported.rows_invalid} righe scartate su ${imported.rows_total}. Serve una colonna con l'URL del profilo LinkedIn.`,
          );
        }

        const name =
          input.campaign_name?.trim() ||
          `${imported.source.replace(/\.csv$/i, '')} — ${new Date().toISOString().slice(0, 10)}`;

        const overrides: CampaignOverrides | undefined =
          input.daily_invite_cap !== undefined ? { caps: { invites: input.daily_invite_cap } } : undefined;

        const campaign = campaigns.createCampaign(
          name,
          campaigns.recommendedSteps({
            ...(input.first_message ? { firstMessage: input.first_message } : {}),
            ...(input.wait_accept_days !== undefined ? { waitAcceptDays: input.wait_accept_days } : {}),
          }),
          overrides,
        );

        const enrolled = campaigns.enrollContacts(campaign.id, contacts.resolveContactIds({ import_id: imported.import_id }));
        campaigns.setCampaignStatus(campaign.id, 'running');

        const shouldStart = input.start_engine !== false;
        if (shouldStart && !engine.isRunning()) await engine.start();

        const st = engine.status();
        const cfg = safety.getSafetySettings();
        const data = {
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          import_id: imported.import_id,
          contacts_imported: imported.contact_count,
          contacts_enrolled: enrolled.enrolled,
          rows_invalid: imported.rows_invalid,
          rows_url_inferred: imported.rows_url_inferred,
          engine_running: st.running,
          daily_invite_target: st.dailyTarget,
          weekly_ceiling: st.weeklyCeiling,
          working_window: `giorni ${cfg.workingDays.join(',')} · ${cfg.workStartHour}:00–${cfg.workEndHour}:00 (${cfg.timezone})`,
          next_steps:
            'Controlla l\'avanzamento con engine_status e get_recent_actions. Se compare uno stop di sicurezza, risolvilo su LinkedIn prima di riprendere.',
        };

        const text = [
          `Campagna "${data.campaign_name}" creata e avviata.`,
          `${data.contacts_enrolled} contatti iscritti (${imported.inserted} nuovi, ${imported.duplicates} già presenti${data.rows_invalid ? `, ${data.rows_invalid} righe scartate` : ''}).`,
          data.engine_running
            ? `Motore attivo: fino a ${data.daily_invite_target} inviti oggi, tetto settimanale ${data.weekly_ceiling}, solo ${data.working_window}.`
            : 'Motore NON avviato (start_engine=false): avvialo con engine_control action="start" quando vuoi.',
          input.first_message
            ? 'Il messaggio personalizzato parte solo dopo che l\'invito è stato accettato.'
            : 'Nessun messaggio post-accettazione impostato: la sequenza si ferma all\'accettazione.',
          imported.rows_url_inferred > 0
            ? `⚠ ${imported.rows_url_inferred} righe avevano solo uno slug invece di un URL completo: l'URL è stato ricostruito, controlla che siano profili reali.`
            : '',
        ]
          .filter(Boolean)
          .join(' ');

        return { content: [textBlock(text)], structuredContent: data };
      } catch (err) {
        return fromException(err, 'Avvio campagna non riuscito');
      }
    },
  );
}
