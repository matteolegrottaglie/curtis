// ============================================================
//  Tipi condivisi in tutta l'app
// ============================================================

// ---- Azioni eseguibili (loggate nella tabella `actions`) ----
export type ActionKind =
  | 'visit' // visita profilo
  | 'connect' // richiesta di collegamento
  | 'message' // messaggio (richiede 1° grado)
  | 'follow' // segui persona
  | 'like' // metti like a un post recente
  | 'withdraw' // ritira invito pendente
  | 'check_accepted'; // verifica se l'invito è stato accettato

export type ActionStatus = 'success' | 'failed' | 'skipped' | 'blocked';

// ---- Step di una sequenza (campaign.steps) ----
export type Step =
  | { type: 'visit' }
  | { type: 'connect'; note?: string }
  | { type: 'wait_accept'; maxDays: number }
  | { type: 'wait'; days?: number; hours?: number }
  | { type: 'message'; text: string }
  | { type: 'follow' }
  | { type: 'like_recent'; count?: number };

export type StepType = Step['type'];

// ---- Stato di un contatto dentro una campagna (macchina a stati) ----
export type EnrollmentStatus =
  | 'enrolled' // appena inserito, non ancora partito
  | 'in_progress' // sta percorrendo gli step
  | 'connect_sent' // invito inviato, in attesa
  | 'accepted' // invito accettato
  | 'completed' // sequenza terminata
  | 'stopped' // fermato manualmente
  | 'failed' // errore irrecuperabile
  | 'not_accepted'; // scaduto il tempo di attesa accettazione

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'archived';

// ---- Segnali di salute rilevati da LinkedIn ----
export type SignalKind =
  | 'weekly_limit' // "hai raggiunto il limite settimanale di inviti"
  | 'captcha' // challenge/verifica
  | 'restriction' // account limitato/sospeso
  | 'warning' // banner generico di avviso
  | 'error'; // errore tecnico ripetuto

// ============================================================
//  Configurazione di sicurezza (modificabile da dashboard)
// ============================================================

export interface RampStep {
  week: number; // settimana di warm-up (1-based)
  dailyInvites: number; // target inviti/giorno in quella settimana
}

export interface SafetyConfig {
  // --- finestra oraria ---
  timezone: string;
  workingDays: number[]; // 1=lun ... 7=dom (weekday luxon)
  workStartHour: number; // ora locale di inizio (0-23)
  workEndHour: number; // ora locale di fine (0-23)

  // --- profilo account (influenza la fase di partenza) ---
  accountAgeDays: number | null;
  connectionCount: number | null;

  // --- tetto "duro" lato LinkedIn ---
  weeklyInviteCeiling: number; // il controller non lo supera MAI

  // --- rampa di warm-up ---
  warmupStartDate: string | null; // ISO date (YYYY-MM-DD) di inizio automazione
  rampStartWeekOffset: number; // salta avanti se l'account è già maturo (0 = parti da week 1)
  ramp: RampStep[];

  // --- controller adattivo ---
  minAcceptanceRate: number; // sotto questa soglia: frena inviti (es. 0.40)
  backoffFactor: number; // riduci target a questa frazione su segnale (es. 0.7)
  recoveryStepPct: number; // +X% per periodo quando i segnali sono puliti (es. 0.10)
  backoffCooldownHours: number; // attesa dopo un segnale prima di riprovare
  cleanDaysToRecover: number; // giorni "puliti" prima di rialzare i limiti

  // --- cap giornalieri per tipo di azione (mix) ---
  caps: {
    invites: number; // tetto assoluto (oltre a rampa/controller)
    messages: number;
    visits: number;
    follows: number;
    likes: number;
    withdraws: number;
  };

  // --- ritardi (ms) e micro-comportamenti umani ---
  delays: {
    betweenActionsMin: number;
    betweenActionsMax: number;
    longBreakEveryMin: number; // dopo N azioni fai una pausa lunga
    longBreakEveryMax: number;
    longBreakMin: number;
    longBreakMax: number;
  };

  // --- comportamento invito ---
  sendNoteOnConnect: boolean; // default FALSE per account free

  // --- gestione backlog inviti pendenti ---
  autoWithdrawAfterDays: number; // ritira inviti più vecchi di N giorni
  maxPendingBacklog: number; // tieni il backlog sotto questa soglia (LinkedIn: ~500)
}

// ============================================================
//  Override per-campagna sulle impostazioni di sicurezza globali.
//  Solo i campi non-null sovrascrivono la SafetyConfig globale
//  quando l'engine processa quella campagna.
//
//  Onorati dall'engine per-campagna:
//   - caps, delays, sendNoteOnConnect (sostituiscono il valore globale)
//   - workingDays, workStartHour, workEndHour, timezone (restrizione *aggiuntiva*
//     sulla finestra oraria: la globale resta necessaria, la per-campagna restringe)
//  Salvati ma non ancora onorati (l'engine usa il globale):
//   - weeklyInviteCeiling, ramp, rampStartWeekOffset, controller adattivo,
//     backlog/withdraw — stato globale del controller, richiede refactor profondo.
// ============================================================
export interface CampaignOverrides {
  sendNoteOnConnect?: boolean;
  caps?: Partial<SafetyConfig['caps']>;
  delays?: Partial<SafetyConfig['delays']>;
  workingDays?: number[];
  workStartHour?: number;
  workEndHour?: number;
  timezone?: string;
  // Snapshot informativi (salvati per visibilità, non ancora applicati per-campagna):
  weeklyInviteCeiling?: number;
  rampStartWeekOffset?: number;
  minAcceptanceRate?: number;
  backoffFactor?: number;
  recoveryStepPct?: number;
  backoffCooldownHours?: number;
  cleanDaysToRecover?: number;
  autoWithdrawAfterDays?: number;
  maxPendingBacklog?: number;
  ramp?: SafetyConfig['ramp'];
}

// ============================================================
//  Stato del controller adattivo (persistito, single-row)
// ============================================================

export interface ControllerState {
  currentDailyTarget: number; // target inviti effettivo per oggi
  currentWeeklyCeiling: number; // tetto settimanale effettivo (<= config.weeklyInviteCeiling)
  backoffUntil: number | null; // epoch ms: sospensione inviti fino a
  lastSignalAt: number | null;
  consecutiveCleanDays: number;
  lastAdjustedDate: string | null; // ISO date dell'ultimo aggiornamento
  paused: boolean; // pausa manuale dell'intero worker
  haltedReason: string | null; // se != null: stop di sicurezza (es. captcha)
}

// ============================================================
//  Righe del database
// ============================================================

export interface Contact {
  id: string;
  profile_url: string;
  public_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  headline: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  custom: string | null; // JSON
  source: string | null;
  created_at: number;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  steps: string; // JSON (Step[])
  settings: string | null; // JSON (override per-campagna)
  created_at: number;
  updated_at: number;
}

export interface CampaignContact {
  id: string;
  campaign_id: string;
  contact_id: string;
  status: EnrollmentStatus;
  current_step: number;
  next_action_at: number | null;
  connect_sent_at: number | null;
  accepted_at: number | null;
  last_action_at: number | null;
  attempts: number;
  last_error: string | null;
  created_at: number;
}

export interface ActionRow {
  id: string;
  campaign_id: string | null;
  contact_id: string | null;
  type: ActionKind;
  status: ActionStatus;
  detail: string | null;
  screenshot: string | null;
  created_at: number;
}

export interface SignalRow {
  id: string;
  kind: SignalKind;
  severity: number; // 1-3
  detail: string | null;
  created_at: number;
}

// ---- Risultato di un'azione browser ----
export interface ActionResult {
  status: ActionStatus;
  detail?: string;
  screenshot?: string;
  signal?: { kind: SignalKind; severity: number; detail?: string };
}
