// ============================================================
//  Fast path: from a contact list to invitations going out
//  in a single call.
//
//  This is the product's main use case: "here is my CSV,
//  start sending the connection requests".
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
      title: 'Start a connection campaign from a list',
      description:
        "The whole path in one shot: imports the contact list, creates a campaign with the recommended safe sequence (visit → wait 1 day → connection request without a note → wait for acceptance → optional first message), enrolls every imported contact, sets the campaign running and starts the engine. Requires an active LinkedIn session. The engine works slowly and only inside the configured working window: that is deliberate, the slowness is the protection.",
      inputSchema: z.object({
        file_path: z.string().optional().describe('Path to the CSV with the contacts'),
        csv_content: z.string().optional().describe('Pasted CSV content (alternative to file_path)'),
        campaign_name: z.string().min(1).max(120).optional().describe('Default: file name + date'),
        first_message: z
          .string()
          .max(1900)
          .optional()
          .describe(
            'Message sent once the invitation has been accepted. This is where the personalisation belongs. Placeholders: {firstName}, {company}, … Spintax: {Hi|Hello}.',
          ),
        wait_accept_days: z.number().int().min(1).max(60).optional().describe('Default 14'),
        daily_invite_cap: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Cap on invitations per day for this campaign. If omitted the global ramp applies.'),
        start_engine: z
          .boolean()
          .optional()
          .describe('Default true. With false it sets everything up but does not start the engine.'),
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
      // It sends real invitations, and calling it twice creates two campaigns on
      // the same contacts: the client has to be told about both.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const auth = await engine.authStatus();
        if (!auth.loggedIn) {
          return errorResult(
            'No active LinkedIn session. Run linkedin_login first: a browser window will open for you to sign in by hand.',
          );
        }
        if (!input.file_path && !input.csv_content) {
          return errorResult('Needs either `file_path` (path to the CSV) or `csv_content` (pasted CSV).');
        }

        const imported = contacts.importContacts({
          ...(input.file_path ? { filePath: input.file_path } : {}),
          ...(input.csv_content ? { csvContent: input.csv_content } : {}),
          previewLimit: 3,
        });
        if (imported.contact_count === 0) {
          return errorResult(
            `No usable contact in the file: ${imported.rows_invalid} rows discarded out of ${imported.rows_total}. A column with the LinkedIn profile URL is required.`,
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
          working_window: `days ${cfg.workingDays.join(',')} · ${cfg.workStartHour}:00–${cfg.workEndHour}:00 (${cfg.timezone})`,
          next_steps:
            'Track progress with engine_status and get_recent_actions. If a safety stop shows up, clear it on LinkedIn before resuming.',
        };

        const text = [
          `Campaign "${data.campaign_name}" created and started.`,
          `${data.contacts_enrolled} contacts enrolled (${imported.inserted} new, ${imported.duplicates} already present${data.rows_invalid ? `, ${data.rows_invalid} rows discarded` : ''}).`,
          data.engine_running
            ? `Engine active: up to ${data.daily_invite_target} invitations today, weekly ceiling ${data.weekly_ceiling}, only ${data.working_window}.`
            : 'Engine NOT started (start_engine=false): start it with engine_control action="start" whenever you like.',
          input.first_message
            ? 'The personalised message only goes out after the invitation has been accepted.'
            : 'No post-acceptance message set: the sequence stops at acceptance.',
          imported.rows_url_inferred > 0
            ? `⚠ ${imported.rows_url_inferred} rows had only a slug instead of a full URL: the URL was reconstructed, check that these are real profiles.`
            : '',
        ]
          .filter(Boolean)
          .join(' ');

        return { content: [textBlock(text)], structuredContent: data };
      } catch (err) {
        return fromException(err, 'Campaign start failed');
      }
    },
  );
}
