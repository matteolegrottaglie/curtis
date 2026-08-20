// ============================================================
//  Contact tools: list import, listing, deletion.
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
      title: 'Import a contact list',
      description:
        "Imports contacts from a CSV, either by pointing at a file path on the user's disk or by pasting the content. At minimum you need the column holding the LinkedIn profile URL (headers recognised in both English and Italian: profile_url, url, linkedin, profilo, link). Also recognised: nome/first_name, cognome/last_name, azienda/company, qualifica/headline, località/location, email. Every other column becomes {custom.COLUMN_NAME}, usable in message templates. Duplicates (a profile already in the database) are not re-inserted but still count as part of the import. Returns an import_id to pass to enroll_contacts.",
      inputSchema: z.object({
        file_path: z.string().optional().describe('Absolute path of the CSV file on the user\'s computer'),
        csv_content: z.string().optional().describe('CSV content pasted directly (alternative to file_path)'),
        preview_limit: z
          .number()
          .int()
          .min(0)
          .max(50)
          .optional()
          .describe('How many contacts to show in the preview (default 5)'),
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
          `Import "${r.source}": ${r.contact_count} usable contacts (${r.inserted} new, ${r.duplicates} already present).`,
        ];
        if (r.rows_invalid > 0) {
          parts.push(`${r.rows_invalid} rows discarded because the profile URL was missing or invalid.`);
        }
        if (r.rows_url_inferred > 0) {
          const sample = r.url_inferred_sample.slice(0, 3).map((x) => `row ${x.row}: "${x.input}"`).join(', ');
          parts.push(
            `⚠ ${r.rows_url_inferred} rows had only a slug instead of a full URL (${sample}): the URL was reconstructed, check that these are real profiles before starting the campaign.`,
          );
        }
        parts.push(`import_id: ${r.import_id}`);
        return { content: [textBlock(parts.join(' '))], structuredContent: r };
      } catch (err) {
        return fromException(err, 'Import failed');
      }
    },
  );

  server.tool(
    {
      name: 'list_contacts',
      title: 'List contacts',
      description: 'Lists the contacts in the database, with an optional search by name, company or URL.',
      inputSchema: z.object({
        search: z.string().optional().describe('Filter on name, company or profile URL'),
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
        content: [textBlock(`Showing ${r.returned} contacts out of ${r.total} total.`)],
        structuredContent: r,
      };
    },
  );

  server.tool(
    {
      name: 'delete_contacts',
      title: 'Delete contacts',
      description:
        'Deletes contacts from the database. Handy for undoing a bad import: pass the import_id. By default it protects contacts already enrolled in a campaign; to remove them anyway pass only_unenrolled=false — that also deletes their enrolments.',
      inputSchema: z.object({
        ...contactSelectionSchema,
        only_unenrolled: z
          .boolean()
          .optional()
          .describe('Default true: skips contacts already enrolled in a campaign'),
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
              `Deleted ${deleted} contacts out of ${ids.length}${data.skipped > 0 ? ` (${data.skipped} skipped because already enrolled in a campaign)` : ''}.`,
            ),
          ],
          structuredContent: data,
        };
      } catch (err) {
        return fromException(err, 'Deletion failed');
      }
    },
  );
}

