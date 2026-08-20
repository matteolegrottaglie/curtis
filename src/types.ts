// ============================================================
//  Types shared across the whole app
// ============================================================

// ---- Executable actions (logged in the `actions` table) ----
export type ActionKind =
  | 'visit' // profile visit
  | 'connect' // connection request
  | 'message' // message (requires 1st degree)
  | 'follow' // follow a person
  | 'like' // like a recent post
  | 'withdraw' // withdraw a pending invite
  | 'check_accepted'; // check whether the invite was accepted

export type ActionStatus = 'success' | 'failed' | 'skipped' | 'blocked';

// ---- Step of a sequence (campaign.steps) ----
export type Step =
  | { type: 'visit' }
  | { type: 'connect'; note?: string }
  | { type: 'wait_accept'; maxDays: number }
  | { type: 'wait'; days?: number; hours?: number }
  | { type: 'message'; text: string }
  | { type: 'follow' }
  | { type: 'like_recent'; count?: number };

export type StepType = Step['type'];

// ---- State of a contact inside a campaign (state machine) ----
export type EnrollmentStatus =
  | 'enrolled' // just added, not started yet
  | 'in_progress' // working through the steps
  | 'connect_sent' // invite sent, waiting
  | 'accepted' // invite accepted
  | 'completed' // sequence finished
  | 'stopped' // stopped manually
  | 'failed' // unrecoverable error
  | 'not_accepted'; // the acceptance wait window expired

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'archived';

// ---- Health signals picked up from LinkedIn ----
export type SignalKind =
  | 'weekly_limit' // "you've reached the weekly invitation limit"
  | 'captcha' // challenge/verification
  | 'restriction' // account restricted/suspended
  | 'warning' // generic warning banner
  | 'error'; // repeated technical error

// ============================================================
//  Safety configuration (editable from the dashboard)
// ============================================================

export interface RampStep {
  week: number; // warm-up week (1-based)
  dailyInvites: number; // target invites/day for that week
}

export interface SafetyConfig {
  // --- time window ---
  timezone: string;
  workingDays: number[]; // 1=Mon ... 7=Sun (luxon weekday)
  workStartHour: number; // local start hour (0-23)
  workEndHour: number; // local end hour (0-23)

  // --- account profile (drives the starting phase) ---
  accountAgeDays: number | null;
  connectionCount: number | null;

  // --- "hard" ceiling on LinkedIn's side ---
  weeklyInviteCeiling: number; // the controller NEVER goes past it

  // --- warm-up ramp ---
  warmupStartDate: string | null; // ISO date (YYYY-MM-DD) automation started
  rampStartWeekOffset: number; // skip ahead if the account is already mature (0 = start at week 1)
  ramp: RampStep[];

  // --- adaptive controller ---
  minAcceptanceRate: number; // below this threshold: throttle invites (e.g. 0.40)
  backoffFactor: number; // cut the target to this fraction on a signal (e.g. 0.7)
  recoveryStepPct: number; // +X% per period while the signals stay clean (e.g. 0.10)
  backoffCooldownHours: number; // wait after a signal before trying again
  cleanDaysToRecover: number; // "clean" days before raising the limits again

  // --- daily caps per action type (mix) ---
  caps: {
    invites: number; // absolute ceiling (on top of ramp/controller)
    messages: number;
    visits: number;
    follows: number;
    likes: number;
    withdraws: number;
  };

  // --- delays (ms) and human micro-behaviours ---
  delays: {
    betweenActionsMin: number;
    betweenActionsMax: number;
    longBreakEveryMin: number; // after N actions take a long break
    longBreakEveryMax: number;
    longBreakMin: number;
    longBreakMax: number;
  };

  // --- invite behaviour ---
  sendNoteOnConnect: boolean; // FALSE by default for free accounts

  // --- pending invite backlog handling ---
  autoWithdrawAfterDays: number; // withdraw invites older than N days
  maxPendingBacklog: number; // keep the backlog under this threshold (LinkedIn: ~500)
}

// ============================================================
//  Per-campaign overrides on the global safety settings.
//  Only non-null fields override the global SafetyConfig
//  when the engine processes that campaign.
//
//  Honoured per-campaign by the engine:
//   - caps, delays, sendNoteOnConnect (they replace the global value)
//   - workingDays, workStartHour, workEndHour, timezone (an *additional*
//     restriction on the time window: the global one still applies, the
//     per-campaign one narrows it)
//  Stored but not honoured yet (the engine uses the global value):
//   - weeklyInviteCeiling, ramp, rampStartWeekOffset, adaptive controller,
//     backlog/withdraw — global controller state, needs a deep refactor.
// ============================================================
export interface CampaignOverrides {
  sendNoteOnConnect?: boolean;
  caps?: Partial<SafetyConfig['caps']>;
  delays?: Partial<SafetyConfig['delays']>;
  workingDays?: number[];
  workStartHour?: number;
  workEndHour?: number;
  timezone?: string;
  // Informational snapshots (stored for visibility, not applied per-campaign yet):
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
//  Adaptive controller state (persisted, single-row)
// ============================================================

export interface ControllerState {
  currentDailyTarget: number; // effective invite target for today
  currentWeeklyCeiling: number; // effective weekly ceiling (<= config.weeklyInviteCeiling)
  backoffUntil: number | null; // epoch ms: invites suspended until
  lastSignalAt: number | null;
  consecutiveCleanDays: number;
  lastAdjustedDate: string | null; // ISO date of the last adjustment
  paused: boolean; // manual pause of the whole worker
  haltedReason: string | null; // if != null: safety stop (e.g. captcha)
}

// ============================================================
//  Database rows
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
  settings: string | null; // JSON (per-campaign overrides)
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

// ---- Result of a browser action ----
export interface ActionResult {
  status: ActionStatus;
  detail?: string;
  screenshot?: string;
  signal?: { kind: SignalKind; severity: number; detail?: string };
}
