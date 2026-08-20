// ============================================================
//  Schemi zod condivisi dai tool MCP.
//
//  Sono gli stessi schemi che validavano le API REST della vecchia
//  dashboard: qui diventano `inputSchema` dei tool, quindi le loro
//  `.describe()` finiscono direttamente nel prompt del modello.
// ============================================================
import { z } from 'zod';

// ---------------- Step di una sequenza ----------------
export const stepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('visit') }).describe('Visita il profilo (azione soft, scalda il contatto)'),
  z
    .object({
      type: z.literal('connect'),
      note: z
        .string()
        .max(300)
        .optional()
        .describe(
          'Nota allegata all\'invito. Sconsigliata sugli account FREE: LinkedIn ne concede solo 5 al mese. Viene inviata solo se sendNoteOnConnect è true.',
        ),
    })
    .describe('Invia la richiesta di collegamento'),
  z
    .object({ type: z.literal('wait_accept'), maxDays: z.number().int().min(1).max(60) })
    .describe('Attendi che l\'invito venga accettato, ricontrollando ogni giorno, fino a maxDays'),
  z
    .object({
      type: z.literal('wait'),
      days: z.number().int().min(0).max(60).optional(),
      hours: z.number().int().min(0).max(72).optional(),
    })
    .describe('Attesa fissa (con jitter ±10%)'),
  z
    .object({
      type: z.literal('message'),
      text: z
        .string()
        .min(1)
        .max(1900)
        .describe(
          'Testo del messaggio. Placeholder: {firstName} {lastName} {fullName} {company} {headline} {location} {custom.COLONNA}. Spintax per variare: {Ciao|Salve|Buongiorno}.',
        ),
    })
    .describe('Invia un messaggio diretto (richiede collegamento di 1° grado)'),
  z.object({ type: z.literal('follow') }).describe('Segui la persona'),
  z
    .object({ type: z.literal('like_recent'), count: z.number().int().min(1).max(5).optional() })
    .describe('Metti "mi piace" a un post recente'),
]);

export const stepsSchema = z.array(stepSchema).min(1);

// ---------------- Config di sicurezza ----------------
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

/** Config completa: usata per validare il risultato di una patch prima di salvarlo. */
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
    message: 'workEndHour deve essere > workStartHour',
  })
  .refine((c) => c.delays.betweenActionsMax >= c.delays.betweenActionsMin, {
    message: 'betweenActionsMax deve essere >= betweenActionsMin',
  })
  .refine((c) => c.delays.longBreakMax >= c.delays.longBreakMin, {
    message: 'longBreakMax deve essere >= longBreakMin',
  })
  .refine((c) => c.delays.longBreakEveryMax >= c.delays.longBreakEveryMin, {
    message: 'longBreakEveryMax deve essere >= longBreakEveryMin',
  });

/**
 * Patch parziale: molto più comoda da chat ("abbassa gli inviti a 10 al giorno"
 * tocca un campo solo). Viene fusa sulla config corrente e poi validata come
 * config completa.
 */
export const safetyConfigPatchSchema = z.object({
  timezone: z.string().min(1).optional().describe('Fuso orario IANA, es. Europe/Rome'),
  workingDays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .optional()
    .describe('Giorni lavorativi, 1=lunedì … 7=domenica'),
  workStartHour: z.number().min(0).max(23).optional().describe('Ora locale di inizio attività'),
  workEndHour: z.number().min(1).max(24).optional().describe('Ora locale di fine attività'),
  accountAgeDays: z.number().int().min(0).nullable().optional(),
  connectionCount: z.number().int().min(0).nullable().optional(),
  weeklyInviteCeiling: z
    .number()
    .int()
    .min(5)
    .max(700)
    .optional()
    .describe('Tetto settimanale duro di inviti. Alzarlo aumenta il rischio: avvisa sempre l\'utente.'),
  warmupStartDate: z.string().nullable().optional().describe('Data ISO YYYY-MM-DD di inizio warm-up'),
  rampStartWeekOffset: z
    .number()
    .int()
    .min(0)
    .max(52)
    .optional()
    .describe('Salta avanti nella rampa se l\'account è già maturo (0 = parti dalla settimana 1)'),
  ramp: z.array(rampSchema).min(1).optional().describe('Rampa di warm-up: inviti/giorno per settimana'),
  minAcceptanceRate: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Sotto questa soglia il controller riduce gli inviti (es. 0.4 = 40%)'),
  backoffFactor: z.number().min(0.1).max(0.99).optional(),
  recoveryStepPct: z.number().min(0.01).max(1).optional(),
  backoffCooldownHours: z.number().min(1).max(168).optional(),
  cleanDaysToRecover: z.number().int().min(1).max(30).optional(),
  caps: capsSchema.partial().optional().describe('Tetti giornalieri per tipo di azione'),
  delays: delaysSchema.partial().optional().describe('Ritardi fra azioni, in millisecondi'),
  sendNoteOnConnect: z
    .boolean()
    .optional()
    .describe('Allega la nota agli inviti. FALSE consigliato sugli account FREE (solo 5 note al mese).'),
  autoWithdrawAfterDays: z.number().int().min(3).max(90).optional(),
  maxPendingBacklog: z.number().int().min(50).max(2000).optional(),
});

export type SafetyConfigPatch = z.infer<typeof safetyConfigPatchSchema>;

// ---------------- Override per-campagna ----------------
export const campaignSettingsSchema = z.object({
  sendNoteOnConnect: z.boolean().optional(),
  caps: capsSchema.partial().optional(),
  delays: delaysSchema.partial().optional(),
  workingDays: z.array(z.number().int().min(1).max(7)).optional(),
  workStartHour: z.number().int().min(0).max(23).optional(),
  workEndHour: z.number().int().min(1).max(24).optional(),
  timezone: z.string().optional(),
});

// ---------------- Selezione contatti ----------------
export const contactSelectionSchema = {
  import_id: z
    .string()
    .optional()
    .describe('ID restituito da import_contacts: seleziona tutti i contatti di quell\'import'),
  contact_ids: z.array(z.string()).max(100_000).optional().describe('Lista esplicita di ID contatto'),
  all: z.boolean().optional().describe('Tutti i contatti presenti nel database'),
};
