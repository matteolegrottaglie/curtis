// ============================================================
//  Zod schemas shared by the MCP tools.
//
//  They are the same schemas that validated the REST API of the old
//  dashboard: here they become the tools' `inputSchema`, so their
//  `.describe()` calls land straight in the model's prompt.
// ============================================================
import { z } from 'zod';

// ---------------- Steps of a sequence ----------------
export const stepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('visit') }).describe('Visit the profile (soft action, warms the contact up)'),
  z
    .object({
      type: z.literal('connect'),
      note: z
        .string()
        .max(300)
        .optional()
        .describe(
          'Note attached to the invitation. Not advised on FREE accounts: LinkedIn allows only 5 a month. It is sent only if sendNoteOnConnect is true.',
        ),
    })
    .describe('Send the connection request'),
  z
    .object({ type: z.literal('wait_accept'), maxDays: z.number().int().min(1).max(60) })
    .describe('Wait for the invitation to be accepted, re-checking every day, up to maxDays'),
  z
    .object({
      type: z.literal('wait'),
      days: z.number().int().min(0).max(60).optional(),
      hours: z.number().int().min(0).max(72).optional(),
    })
    .describe('Fixed wait (with ±10% jitter)'),
  z
    .object({
      type: z.literal('message'),
      text: z
        .string()
        .min(1)
        .max(1900)
        .describe(
          'Message text. Placeholders: {firstName} {lastName} {fullName} {company} {headline} {location} {custom.COLUMN_NAME}. Spintax for variety: {Hi|Hello|Good morning}.',
        ),
    })
    .describe('Send a direct message (requires a 1st-degree connection)'),
  z.object({ type: z.literal('follow') }).describe('Follow the person'),
  z
    .object({ type: z.literal('like_recent'), count: z.number().int().min(1).max(5).optional() })
    .describe('Like a recent post'),
]);

export const stepsSchema = z.array(stepSchema).min(1);

// ---------------- Safety config ----------------
const rampSchema = z.object({
  week: z.number().int().min(1),
  dailyInvites: z.number().int().min(0).max(100),
});

const capsSchema = z.object({
  invites: z.number().int().min(0).max(100),
  messages: z.number().int().min(0).max(200),
  visits: z.number().int().min(0).max(300),
  follows: z.number().int().min(0).max(100),
  likes: z.number().int().min(0).max(200),
  withdraws: z.number().int().min(0).max(100),
});

const delaysSchema = z.object({
  betweenActionsMin: z.number().int().min(5_000),
  betweenActionsMax: z.number().int().min(10_000),
  longBreakEveryMin: z.number().int().min(1),
  longBreakEveryMax: z.number().int().min(1),
  longBreakMin: z.number().int().min(60_000),
  longBreakMax: z.number().int().min(60_000),
});

/** Full config: used to validate the result of a patch before saving it. */
export const safetyConfigSchema = z
  .object({
    timezone: z.string().min(1),
    workingDays: z.array(z.number().int().min(1).max(7)).min(1),
    workStartHour: z.number().min(0).max(23),
    workEndHour: z.number().min(1).max(24),
    accountAgeDays: z.number().int().min(0).nullable(),
    connectionCount: z.number().int().min(0).nullable(),
    weeklyInviteCeiling: z.number().int().min(5).max(700),
    warmupStartDate: z.string().nullable(),
    rampStartWeekOffset: z.number().int().min(0).max(52),
    ramp: z.array(rampSchema).min(1),
    minAcceptanceRate: z.number().min(0).max(1),
    backoffFactor: z.number().min(0.1).max(0.99),
    recoveryStepPct: z.number().min(0.01).max(1),
    backoffCooldownHours: z.number().min(1).max(168),
    cleanDaysToRecover: z.number().int().min(1).max(30),
    caps: capsSchema,
    delays: delaysSchema,
    sendNoteOnConnect: z.boolean(),
    autoWithdrawAfterDays: z.number().int().min(3).max(90),
    maxPendingBacklog: z.number().int().min(50).max(2000),
  })
  .refine((c) => c.workEndHour > c.workStartHour, {
    message: 'workEndHour must be > workStartHour',
  })
  .refine((c) => c.delays.betweenActionsMax >= c.delays.betweenActionsMin, {
    message: 'betweenActionsMax must be >= betweenActionsMin',
  })
  .refine((c) => c.delays.longBreakMax >= c.delays.longBreakMin, {
    message: 'longBreakMax must be >= longBreakMin',
  })
  .refine((c) => c.delays.longBreakEveryMax >= c.delays.longBreakEveryMin, {
    message: 'longBreakEveryMax must be >= longBreakEveryMin',
  });

/**
 * Partial patch: far handier from chat ("lower the invitations to 10 a day"
 * touches a single field). It is merged onto the current config and then
 * validated as a full config.
 */
export const safetyConfigPatchSchema = z.object({
  timezone: z.string().min(1).optional().describe('IANA time zone, e.g. Europe/Rome'),
  workingDays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .optional()
    .describe('Working days, 1=Monday … 7=Sunday'),
  workStartHour: z.number().min(0).max(23).optional().describe('Local hour activity starts'),
  workEndHour: z.number().min(1).max(24).optional().describe('Local hour activity ends'),
  accountAgeDays: z.number().int().min(0).nullable().optional(),
  connectionCount: z.number().int().min(0).nullable().optional(),
  weeklyInviteCeiling: z
    .number()
    .int()
    .min(5)
    .max(700)
    .optional()
    .describe('Hard weekly ceiling on invitations. Raising it raises the risk: always warn the user.'),
  warmupStartDate: z.string().nullable().optional().describe('ISO date YYYY-MM-DD the warm-up starts'),
  rampStartWeekOffset: z
    .number()
    .int()
    .min(0)
    .max(52)
    .optional()
    .describe('Skip ahead in the ramp if the account is already mature (0 = start from week 1)'),
  ramp: z.array(rampSchema).min(1).optional().describe('Warm-up ramp: invitations/day per week'),
  minAcceptanceRate: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Below this threshold the controller cuts invitations (e.g. 0.4 = 40%)'),
  backoffFactor: z.number().min(0.1).max(0.99).optional(),
  recoveryStepPct: z.number().min(0.01).max(1).optional(),
  backoffCooldownHours: z.number().min(1).max(168).optional(),
  cleanDaysToRecover: z.number().int().min(1).max(30).optional(),
  caps: capsSchema.partial().optional().describe('Daily ceilings per action type'),
  delays: delaysSchema.partial().optional().describe('Delays between actions, in milliseconds'),
  sendNoteOnConnect: z
    .boolean()
    .optional()
    .describe('Attach the note to invitations. FALSE advised on FREE accounts (only 5 notes a month).'),
  autoWithdrawAfterDays: z.number().int().min(3).max(90).optional(),
  maxPendingBacklog: z.number().int().min(50).max(2000).optional(),
});

export type SafetyConfigPatch = z.infer<typeof safetyConfigPatchSchema>;

// ---------------- Per-campaign overrides ----------------
export const campaignSettingsSchema = z.object({
  sendNoteOnConnect: z.boolean().optional(),
  caps: capsSchema.partial().optional(),
  delays: delaysSchema.partial().optional(),
  workingDays: z.array(z.number().int().min(1).max(7)).optional(),
  workStartHour: z.number().int().min(0).max(23).optional(),
  workEndHour: z.number().int().min(1).max(24).optional(),
  timezone: z.string().optional(),
});

// ---------------- Contact selection ----------------
export const contactSelectionSchema = {
  import_id: z
    .string()
    .optional()
    .describe('ID returned by import_contacts: selects every contact from that import'),
  contact_ids: z.array(z.string()).max(100_000).optional().describe('Explicit list of contact IDs'),
  all: z.boolean().optional().describe('Every contact in the database'),
};
