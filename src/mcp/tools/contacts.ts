// ============================================================
//  Tool sui contatti: import della lista, elenco, cancellazione.
// ============================================================
import { z } from 'zod';
import type { MCPServer } from 'mcp-use';
import * as contacts from '../../service/contacts.js';
import { contactSelectionSchema } from '../schemas.js';
import { fromException, textBlock } from '../result.js';

const contactPreviewSchema = z.object({
  id: z.string(),
  full_name: z.string().nullable(),
  company: z.string().nullable(),
  profile_url: z.string(),
});

export function registerContactTools(server: MCPServer): void {
  server.tool(
    {
      name: 'import_contacts',
      title: 'Importa una lista di contatti',
      description:
        "Importa contatti da un CSV, indicando il percorso del file sul disco dell'utente oppure incollando il contenuto. Serve almeno la colonna con l'URL del profilo LinkedIn (intestazioni riconosciute in italiano e inglese: profile_url, url, linkedin, profilo, link). Colonne riconosciute anche: nome/first_name, cognome/last_name, azienda/company, qualifica/headline, località/location, email. Ogni altra colonna diventa {custom.NOME_COLONNA}, usabile nei template dei messaggi. I duplicati (stesso profilo già in database) non vengono reinseriti ma fanno comunque parte dell'import. Restituisce un import_id da passare a enroll_contacts.",
      inputSchema: z.object({
        file_path: z.string().optional().describe('Percorso assoluto del file CSV sul computer dell\'utente'),
        csv_content: z.string().optional().describe('Contenuto CSV incollato direttamente (alternativa a file_path)'),
        preview_limit: z
          .number()
          .int()
          .min(0)
          .max(50)
          .optional()
          .describe('Quanti contatti mostrare in anteprima (default 5)'),
      }),
      outputSchema: z.object({
        import_id: z.string(),
        source: z.string(),
        rows_total: z.number(),
        rows_valid: z.number(),
        inserted: z.number(),
        duplicates: z.number(),
        rows_invalid: z.number(),
        invalid_sample: z.array(z.object({ row: z.number(), reason: z.string() })),
        rows_url_inferred: z.number(),
        url_inferred_sample: z.array(z.object({ row: z.number(), input: z.string(), url: z.string() })),
        contact_count: z.number(),
        preview: z.array(contactPreviewSchema),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ file_path, csv_content, preview_limit }) => {
      try {
        const r = contacts.importContacts({
          ...(file_path ? { filePath: file_path } : {}),
          ...(csv_content ? { csvContent: csv_content } : {}),
          ...(preview_limit !== undefined ? { previewLimit: preview_limit } : {}),
        });
        const parts = [
          `Import "${r.source}": ${r.contact_count} contatti utilizzabili (${r.inserted} nuovi, ${r.duplicates} già presenti).`,
        ];
        if (r.rows_invalid > 0) {
          parts.push(`${r.rows_invalid} righe scartate perché l'URL del profilo mancava o non era valido.`);
        }
        if (r.rows_url_inferred > 0) {
          const sample = r.url_inferred_sample.slice(0, 3).map((x) => `riga ${x.row}: "${x.input}"`).join(', ');
          parts.push(
            `⚠ ${r.rows_url_inferred} righe avevano solo uno slug e non un URL completo (${sample}): l'URL è stato ricostruito, verifica che siano profili reali prima di avviare la campagna.`,
          );
        }
        parts.push(`import_id: ${r.import_id}`);
        return { content: [textBlock(parts.join(' '))], structuredContent: r };
      } catch (err) {
        return fromException(err, 'Import non riuscito');
      }
    },
  );

  server.tool(
    {
      name: 'list_contacts',
      title: 'Elenca i contatti',
      description: 'Elenca i contatti in database, con ricerca opzionale per nome, azienda o URL.',
      inputSchema: z.object({
        search: z.string().optional().describe('Filtro su nome, azienda o URL profilo'),
        limit: z.number().int().min(1).max(200).optional().describe('Default 25'),
        offset: z.number().int().min(0).optional(),
      }),
      outputSchema: z.object({
        total: z.number(),
        returned: z.number(),
        contacts: z.array(contactPreviewSchema),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ search, limit, offset }) => {
      const r = contacts.listContacts({
        ...(search ? { search } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {}),
      });
      return {
        content: [textBlock(`${r.returned} contatti mostrati su ${r.total} totali.`)],
        structuredContent: r,
      };
    },
  );

  server.tool(
    {
      name: 'delete_contacts',
      title: 'Cancella contatti',
      description:
        'Cancella contatti dal database. Utile per annullare un import sbagliato: passa l\'import_id. Di default protegge i contatti già iscritti a una campagna; per rimuoverli comunque passa only_unenrolled=false — questo cancella anche le loro iscrizioni.',
      inputSchema: z.object({
        ...contactSelectionSchema,
        only_unenrolled: z
          .boolean()
          .optional()
          .describe('Default true: salta i contatti già iscritti a una campagna'),
      }),
      outputSchema: z.object({ requested: z.number(), deleted: z.number(), skipped: z.number() }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ import_id, contact_ids, all, only_unenrolled }) => {
      try {
        const ids = contacts.resolveContactIds({
          ...(import_id ? { import_id } : {}),
          ...(contact_ids ? { contact_ids } : {}),
          ...(all !== undefined ? { all } : {}),
        });
        const deleted = contacts.deleteContacts(ids, only_unenrolled ?? true);
        const data = { requested: ids.length, deleted, skipped: ids.length - deleted };
        return {
          content: [
            textBlock(
              `Cancellati ${deleted} contatti su ${ids.length}${data.skipped > 0 ? ` (${data.skipped} saltati perché già iscritti a una campagna)` : ''}.`,
            ),
          ],
          structuredContent: data,
        };
      } catch (err) {
        return fromException(err, 'Cancellazione non riuscita');
      }
    },
  );
}

