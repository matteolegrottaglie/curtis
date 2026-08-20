// ============================================================
//  Safety settings tools (ramp, ceilings, delays).
// ============================================================
import { z } from 'zod';
import type { MCPServer } from 'mcp-use';
import * as safety from '../../service/safety.js';
import { safetyConfigPatchSchema } from '../schemas.js';
import { fromException, textBlock } from '../result.js';
import type { SafetyConfig } from '../../types.js';

// The config travels as a free-form object: its exact shape is already
// guaranteed by zod validation on the service side, and repeating it here
// would only make things brittle.
const safetyOutput = z.object({
  settings: z.record(z.string(), z.unknown()),
  summary: z.string(),
});

function summarize(c: SafetyConfig): string {
  const days = c.workingDays.join(',');
  return [
    `Window: days ${days}, ${c.workStartHour}:00–${c.workEndHour}:00 (${c.timezone}).`,
    `Weekly invitation ceiling ${c.weeklyInviteCeiling}, daily caps: invites ${c.caps.invites}, messages ${c.caps.messages}, visits ${c.caps.visits}.`,
    `Ramp: ${c.ramp.map((r) => `week ${r.week}→${r.dailyInvites}/day`).join(', ')}.`,
    `Delay between actions ${Math.round(c.delays.betweenActionsMin / 1000)}–${Math.round(c.delays.betweenActionsMax / 1000)}s.`,
    `Invitation note: ${c.sendNoteOnConnect ? 'ON' : 'off'}. Acceptance threshold ${Math.round(c.minAcceptanceRate * 100)}%.`,
  ].join(' ');
}

export function registerSafetyTools(server: MCPServer): void {
  server.tool(
    {
      name: 'get_safety_settings',
      title: 'Read the safety settings',
      description:
        'Returns the warm-up ramp, the daily and weekly ceilings, the working window, the delays between actions and the adaptive controller thresholds.',
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
      title: 'Change the safety settings',
      description:
        "Updates only the fields you pass; everything else stays as it is. WARNING: raising weeklyInviteCeiling or the caps, or shortening the delays, measurably increases the risk of getting the account restricted. Before raising them, say so explicitly to the user and ask for confirmation. Lowering them is always safe.",
      inputSchema: safetyConfigPatchSchema,
      outputSchema: safetyOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (patch) => {
      try {
        const c = safety.updateSafetySettings(patch);
        const summary = summarize(c);
        return {
          content: [textBlock(`Settings updated. ${summary}`)],
          structuredContent: { settings: c as unknown as Record<string, unknown>, summary },
        };
      } catch (err) {
        return fromException(err, 'Update failed');
      }
    },
  );
}
