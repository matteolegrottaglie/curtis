// ============================================================
//  Campaign (sequence) tools and contact enrolment.
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
 * `CampaignView` uses narrow types (Step[], CampaignOverrides); the outputSchema
 * declares generic JSON. This mapper bridges the two in a single place.
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
  return `Campaign "${c.name}" (${c.id}) — status ${c.status}, ${c.steps.length} steps${counts ? `. Enrolled → ${counts}` : '. No contacts enrolled.'}`;
}

export function registerCampaignTools(server: MCPServer): void {
  server.tool(
    {
      name: 'create_campaign',
      title: 'Create a campaign',
      description:
        'Creates a sequence of actions. If you omit `steps`, it uses the sequence recommended for FREE accounts: profile visit → wait 1 day → connection request WITHOUT a note → wait 14 days for acceptance → (optional) first message. The campaign starts out as "draft": it has to be switched to "running" with set_campaign_status before the engine will execute it.',
      inputSchema: z.object({
        name: z.string().min(1).max(120).describe('Campaign name'),
        steps: stepsSchema.optional().describe('Custom sequence. Omit it to use the recommended one.'),
        first_message: z
          .string()
          .max(1900)
          .optional()
          .describe(
            'Recommended sequence only: text of the first message after acceptance. This is where the personalisation belongs, not in the invitation note.',
          ),
        wait_accept_days: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe('Recommended sequence only: days to wait for acceptance (default 14)'),
        settings: campaignSettingsSchema
          .optional()
          .describe('Overrides for this campaign: ceilings, delays, working window, invitation note'),
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
        return fromException(err, 'Campaign creation failed');
      }
    },
  );

  server.tool(
    {
      name: 'list_campaigns',
      title: 'List campaigns',
      description: 'Lists every campaign with its status, steps and enrolment counts broken down by state.',
      inputSchema: z.object({}),
      outputSchema: z.object({ campaigns: z.array(campaignSchema) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const list = campaigns.listCampaigns();
      const text = list.length ? list.map(describe).join('\n') : 'No campaigns created yet.';
      return { content: [textBlock(text)], structuredContent: { campaigns: list.map(toWire) } };
    },
  );

  server.tool(
    {
      name: 'get_campaign',
      title: 'Campaign detail',
      description: 'Returns one campaign with its steps and the state of its enrolled contacts.',
      inputSchema: z.object({ campaign_id: z.string() }),
      outputSchema: campaignSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ campaign_id }) => {
      try {
        const c = campaigns.getCampaign(campaign_id);
        return { content: [textBlock(describe(c))], structuredContent: toWire(c) };
      } catch (err) {
        return fromException(err, 'Campaign not found');
      }
    },
  );

  server.tool(
    {
      name: 'update_campaign',
      title: 'Edit a campaign',
      description:
        'Changes the name, steps or overrides of a campaign. Careful: changing the steps of a campaign already under way shifts enrolled contacts onto different step indexes.',
      inputSchema: z.object({
        campaign_id: z.string(),
        name: z.string().min(1).max(120).optional(),
        steps: stepsSchema.optional(),
        settings: campaignSettingsSchema.nullable().optional().describe('null clears the overrides'),
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
        return fromException(err, 'Update failed');
      }
    },
  );

  server.tool(
    {
      name: 'set_campaign_status',
      title: 'Change a campaign status',
      description:
        'Sets the status: "running" makes it executable by the engine, "paused" suspends it (enrolled contacts stay where they are), "draft" sends it back to draft, "archived" puts it aside. Note: setting a campaign to running does NOT start the engine — you also need engine_control action="start".',
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
        return fromException(err, 'Status change failed');
      }
    },
  );

  server.tool(
    {
      name: 'delete_campaign',
      title: 'Delete a campaign',
      description:
        'Permanently deletes a campaign and the enrolments of its contacts. The contacts stay in the database, and the history of actions already performed stays in the logs.',
      inputSchema: z.object({ campaign_id: z.string() }),
      outputSchema: z.object({ deleted: z.boolean(), campaign_id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ campaign_id }) => {
      try {
        campaigns.deleteCampaign(campaign_id);
        return {
          content: [textBlock(`Campaign ${campaign_id} deleted.`)],
          structuredContent: { deleted: true, campaign_id },
        };
      } catch (err) {
        return fromException(err, 'Deletion failed');
      }
    },
  );

  server.tool(
    {
      name: 'enroll_contacts',
      title: 'Enroll contacts in a campaign',
      description:
        'Enrolls contacts in a campaign: they start from the first step. Pick which contacts with import_id (the ones from an import you just ran), contact_ids, or all=true. Contacts already enrolled in that campaign are ignored.',
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
              `Enrolled ${r.enrolled} contacts out of the ${r.requested} requested${r.enrolled < r.requested ? ' (the rest were already enrolled in this campaign)' : ''}.`,
            ),
          ],
          structuredContent: { campaign_id, ...r },
        };
      } catch (err) {
        return fromException(err, 'Enrolment failed');
      }
    },
  );
}
