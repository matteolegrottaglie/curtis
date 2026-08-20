// ============================================================
//  Tool sulle campagne (sequenze) e sull'iscrizione dei contatti.
// ============================================================
import { z } from 'zod';
import type { MCPServer } from 'mcp-use';
import * as campaigns from '../../service/campaigns.js';
import * as contacts from '../../service/contacts.js';
import { campaignSettingsSchema, contactSelectionSchema, stepsSchema } from '../schemas.js';
import { fromException, textBlock } from '../result.js';
import type { CampaignView } from '../../service/campaigns.js';

const campaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['draft', 'running', 'paused', 'archived']),
  steps: z.array(z.record(z.string(), z.unknown())),
  settings: z.record(z.string(), z.unknown()).nullable(),
  counts: z.record(z.string(), z.number()),
  created_at: z.number(),
  updated_at: z.number(),
});

type CampaignWire = z.infer<typeof campaignSchema>;

/**
 * `CampaignView` usa tipi stretti (Step[], CampaignOverrides); l'outputSchema
 * dichiara JSON generico. Questo mapper fa il ponte in un punto solo.
 */
function toWire(c: CampaignView): CampaignWire {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    steps: c.steps as unknown as Record<string, unknown>[],
    settings: (c.settings ?? null) as Record<string, unknown> | null,
    counts: c.counts,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

function describe(c: CampaignView): string {
  const counts = Object.entries(c.counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return `Campagna "${c.name}" (${c.id}) — stato ${c.status}, ${c.steps.length} step${counts ? `. Iscritti → ${counts}` : '. Nessun contatto iscritto.'}`;
}

export function registerCampaignTools(server: MCPServer): void {
  server.tool(
    {
      name: 'create_campaign',
      title: 'Crea una campagna',
      description:
        'Crea una sequenza di azioni. Se non passi `steps`, usa la sequenza consigliata per gli account FREE: visita profilo → attesa 1 giorno → collegamento SENZA nota → attesa accettazione 14 giorni → (opzionale) primo messaggio. La campagna nasce in stato "draft": va messa in "running" con set_campaign_status perché l\'engine la esegua.',
      inputSchema: z.object({
        name: z.string().min(1).max(120).describe('Nome della campagna'),
        steps: stepsSchema.optional().describe('Sequenza personalizzata. Omettila per usare quella consigliata.'),
        first_message: z
          .string()
          .max(1900)
          .optional()
          .describe(
            'Solo con la sequenza consigliata: testo del primo messaggio dopo l\'accettazione. È qui che va la personalizzazione, non nella nota dell\'invito.',
          ),
        wait_accept_days: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe('Solo con la sequenza consigliata: giorni di attesa dell\'accettazione (default 14)'),
        settings: campaignSettingsSchema
          .optional()
          .describe('Override per questa campagna: tetti, ritardi, finestra oraria, nota sull\'invito'),
      }),
      outputSchema: campaignSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ name, steps, first_message, wait_accept_days, settings }) => {
      try {
        const finalSteps =
          steps ??
          campaigns.recommendedSteps({
            ...(first_message ? { firstMessage: first_message } : {}),
            ...(wait_accept_days !== undefined ? { waitAcceptDays: wait_accept_days } : {}),
          });
        const c = campaigns.createCampaign(name, finalSteps, settings);
        return { content: [textBlock(describe(c))], structuredContent: toWire(c) };
      } catch (err) {
        return fromException(err, 'Creazione campagna non riuscita');
      }
    },
  );

  server.tool(
    {
      name: 'list_campaigns',
      title: 'Elenca le campagne',
      description: 'Elenca tutte le campagne con stato, step e conteggio degli iscritti per stato.',
      inputSchema: z.object({}),
      outputSchema: z.object({ campaigns: z.array(campaignSchema) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const list = campaigns.listCampaigns();
      const text = list.length ? list.map(describe).join('\n') : 'Nessuna campagna creata.';
      return { content: [textBlock(text)], structuredContent: { campaigns: list.map(toWire) } };
    },
  );

  server.tool(
    {
      name: 'get_campaign',
      title: 'Dettaglio di una campagna',
      description: 'Restituisce una campagna con i suoi step e lo stato degli iscritti.',
      inputSchema: z.object({ campaign_id: z.string() }),
      outputSchema: campaignSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ campaign_id }) => {
      try {
        const c = campaigns.getCampaign(campaign_id);
        return { content: [textBlock(describe(c))], structuredContent: toWire(c) };
      } catch (err) {
        return fromException(err, 'Campagna non trovata');
      }
    },
  );

  server.tool(
    {
      name: 'update_campaign',
      title: 'Modifica una campagna',
      description:
        'Cambia nome, step o override di una campagna. Attenzione: cambiare gli step di una campagna già avviata sposta gli iscritti su indici di step diversi.',
      inputSchema: z.object({
        campaign_id: z.string(),
        name: z.string().min(1).max(120).optional(),
        steps: stepsSchema.optional(),
        settings: campaignSettingsSchema.nullable().optional().describe('null azzera gli override'),
      }),
      outputSchema: campaignSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ campaign_id, name, steps, settings }) => {
      try {
        const c = campaigns.updateCampaign(campaign_id, {
          ...(name !== undefined ? { name } : {}),
          ...(steps !== undefined ? { steps } : {}),
          ...(settings !== undefined ? { settings } : {}),
        });
        return { content: [textBlock(describe(c))], structuredContent: toWire(c) };
      } catch (err) {
        return fromException(err, 'Modifica non riuscita');
      }
    },
  );

  server.tool(
    {
      name: 'set_campaign_status',
      title: 'Cambia stato di una campagna',
      description:
        'Imposta lo stato: "running" la rende eseguibile dall\'engine, "paused" la sospende (gli iscritti restano dove sono), "draft" la riporta in bozza, "archived" la mette da parte. Nota: mettere una campagna in running NON avvia l\'engine — serve anche engine_control action="start".',
      inputSchema: z.object({
        campaign_id: z.string(),
        status: z.enum(['draft', 'running', 'paused', 'archived']),
      }),
      outputSchema: campaignSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ campaign_id, status }) => {
      try {
        const c = campaigns.setCampaignStatus(campaign_id, status);
        return { content: [textBlock(describe(c))], structuredContent: toWire(c) };
      } catch (err) {
        return fromException(err, 'Cambio stato non riuscito');
      }
    },
  );

  server.tool(
    {
      name: 'delete_campaign',
      title: 'Elimina una campagna',
      description:
        'Elimina definitivamente una campagna e le iscrizioni dei suoi contatti. I contatti restano in database, e lo storico delle azioni già eseguite resta nei log.',
      inputSchema: z.object({ campaign_id: z.string() }),
      outputSchema: z.object({ deleted: z.boolean(), campaign_id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ campaign_id }) => {
      try {
        campaigns.deleteCampaign(campaign_id);
        return {
          content: [textBlock(`Campagna ${campaign_id} eliminata.`)],
          structuredContent: { deleted: true, campaign_id },
        };
      } catch (err) {
        return fromException(err, 'Eliminazione non riuscita');
      }
    },
  );

  server.tool(
    {
      name: 'enroll_contacts',
      title: 'Iscrivi contatti a una campagna',
      description:
        'Iscrive contatti a una campagna: partiranno dal primo step. Indica quali contatti con import_id (quelli di un import appena fatto), contact_ids, oppure all=true. I contatti già iscritti a quella campagna vengono ignorati.',
      inputSchema: z.object({ campaign_id: z.string(), ...contactSelectionSchema }),
      outputSchema: z.object({ campaign_id: z.string(), requested: z.number(), enrolled: z.number() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ campaign_id, import_id, contact_ids, all }) => {
      try {
        const ids = contacts.resolveContactIds({
          ...(import_id ? { import_id } : {}),
          ...(contact_ids ? { contact_ids } : {}),
          ...(all !== undefined ? { all } : {}),
        });
        const r = campaigns.enrollContacts(campaign_id, ids);
        return {
          content: [
            textBlock(
              `Iscritti ${r.enrolled} contatti su ${r.requested} richiesti${r.enrolled < r.requested ? ' (gli altri erano già iscritti a questa campagna)' : ''}.`,
            ),
          ],
          structuredContent: { campaign_id, ...r },
        };
      } catch (err) {
        return fromException(err, 'Iscrizione non riuscita');
      }
    },
  );
}
