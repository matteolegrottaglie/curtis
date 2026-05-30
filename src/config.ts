// ============================================================
//  Configurazione: infrastruttura (da .env) + default di sicurezza.
//  I default di sicurezza vengono salvati nel DB alla prima esecuzione
//  e poi modificati dalla dashboard.
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SafetyConfig, ControllerState } from './types.js';

// --- mini parser .env (nessuna dipendenza) ---
function loadDotEnv(): void {
  const p = resolve(process.cwd(), '.env');
  if (!existsSync(p)) return;
  const txt = readFileSync(p, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  timezone: string;
  headful: boolean;
  browserChannel: string | undefined;
  autoConnect: boolean;
}

export const appConfig: AppConfig = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 4310),
  dataDir: resolve(process.cwd(), process.env.DATA_DIR ?? './data'),
  timezone: process.env.TIMEZONE ?? 'Europe/Rome',
  headful: (process.env.HEADFUL ?? 'true') !== 'false',
  browserChannel: process.env.BROWSER_CHANNEL?.trim() || undefined,
  autoConnect: (process.env.AUTO_CONNECT ?? 'true') !== 'false',
};

// ============================================================
//  Default di sicurezza — conservativi per account FREE.
//  Rampa pensata per partire ~80 inviti/settimana e salire,
//  ma SEMPRE limitata dal tetto settimanale e dall'acceptance rate.
// ============================================================
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  timezone: appConfig.timezone,
  workingDays: [1, 2, 3, 4, 5], // lun-ven
  workStartHour: 9,
  workEndHour: 18,

  accountAgeDays: null,
  connectionCount: null,

  // Tetto "duro": LinkedIn impone ~100/settimana agli account standard.
  // Alzalo SOLO quando l'account ha guadagnato trust (e idealmente Sales Navigator).
  weeklyInviteCeiling: 100,

  warmupStartDate: null, // impostata al primo avvio se assente
  rampStartWeekOffset: 0,
  ramp: [
    { week: 1, dailyInvites: 12 }, // ~60/sett
    { week: 2, dailyInvites: 16 }, // ~80/sett  <- obiettivo di partenza
    { week: 3, dailyInvites: 18 },
    { week: 4, dailyInvites: 20 }, // ~100/sett (tocca il tetto di default)
    { week: 5, dailyInvites: 22 },
    { week: 6, dailyInvites: 25 }, // oltre serve alzare weeklyInviteCeiling + trust
  ],

  minAcceptanceRate: 0.4,
  backoffFactor: 0.7,
  recoveryStepPct: 0.1,
  backoffCooldownHours: 24,
  cleanDaysToRecover: 3,

  caps: {
    invites: 30, // tetto assoluto di sicurezza (la rampa di solito sta sotto)
    messages: 40,
    visits: 60,
    follows: 25,
    likes: 30,
    withdraws: 20,
  },

  delays: {
    betweenActionsMin: 40_000, // 40s
    betweenActionsMax: 200_000, // ~3.3 min
    longBreakEveryMin: 6, // dopo 6-12 azioni...
    longBreakEveryMax: 12,
    longBreakMin: 8 * 60_000, // ...pausa 8-25 min
    longBreakMax: 25 * 60_000,
  },

  sendNoteOnConnect: false, // FREE: nota -> taglio a ~5/sett. Personalizza nel 1° messaggio.

  autoWithdrawAfterDays: 21,
  maxPendingBacklog: 500,
};

export const DEFAULT_CONTROLLER_STATE: ControllerState = {
  currentDailyTarget: 0,
  currentWeeklyCeiling: DEFAULT_SAFETY_CONFIG.weeklyInviteCeiling,
  backoffUntil: null,
  lastSignalAt: null,
  consecutiveCleanDays: 0,
  lastAdjustedDate: null,
  paused: false,
  haltedReason: null,
};
