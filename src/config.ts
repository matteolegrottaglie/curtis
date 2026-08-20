// ============================================================
//  Configurazione: infrastruttura + default di sicurezza.
//
//  A differenza del progetto originale (dashboard lanciata dalla
//  cartella del repo), qui il binario `lksq` è installato
//  globalmente: la working directory è arbitraria, quindi i dati
//  vivono in una directory dell'utente, non in `./data`.
//
//  Ordine di risoluzione: process.env  ->  <dataDir>/.env  ->  default.
// ============================================================
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { SafetyConfig, ControllerState } from './types.js';

/** Espande un `~` iniziale e restituisce un path assoluto. */
function expandHome(p: string): string {
  return resolve(p.startsWith('~/') || p === '~' ? join(homedir(), p.slice(1)) : p);
}

/**
 * Directory dati: DB SQLite, profilo browser (sessione LinkedIn), token,
 * screenshot e log. Sovrascrivibile con `LKSQ_DATA_DIR` — è anche il modo
 * per riusare i dati del progetto originale puntando alla sua `./data`.
 */
export const DATA_DIR: string = process.env.LKSQ_DATA_DIR?.trim()
  ? expandHome(process.env.LKSQ_DATA_DIR.trim())
  : join(homedir(), '.linkedin-sequencer-mcp');

// --- mini parser .env (nessuna dipendenza) ---
function loadDotEnv(dir: string): void {
  const p = join(dir, '.env');
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
    // process.env ha la precedenza: il file non sovrascrive mai l'ambiente.
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv(DATA_DIR);

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  timezone: string;
  headful: boolean;
  browserChannel: string | undefined;
  autoConnect: boolean;
  autostartEngine: boolean;
}

export const appConfig: AppConfig = {
  // Il server MCP resta sempre in loopback: espone azioni che agiscono
  // sull'account LinkedIn dell'utente, non va mai messo in ascolto pubblico.
  host: '127.0.0.1',
  port: Number(process.env.LKSQ_PORT ?? 4311),
  dataDir: DATA_DIR,
  timezone: process.env.TIMEZONE ?? 'Europe/Rome',
  headful: (process.env.HEADFUL ?? 'true') !== 'false',
  browserChannel: process.env.BROWSER_CHANNEL?.trim() || undefined,
  autoConnect: (process.env.AUTO_CONNECT ?? 'true') !== 'false',
  autostartEngine: (process.env.AUTOSTART_ENGINE ?? 'false') === 'true',
};

/** Path dei file di servizio dentro la data dir. */
export const paths = {
  db: join(DATA_DIR, 'sequencer.db'),
  browserProfile: join(DATA_DIR, 'browser-profile'),
  screenshots: join(DATA_DIR, 'screenshots'),
  token: join(DATA_DIR, 'token'),
  pid: join(DATA_DIR, 'daemon.pid'),
  logFile: join(DATA_DIR, 'daemon.log'),
  env: join(DATA_DIR, '.env'),
  accepted: join(DATA_DIR, 'terms-accepted'),
} as const;

export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Token bearer che protegge l'endpoint MCP locale.
 *
 * Serve davvero: un server HTTP in loopback è raggiungibile da qualunque
 * processo — e da qualunque pagina web aperta nel browser dell'utente se
 * l'anti DNS-rebinding fallisse. Chi lo raggiunge può mandare inviti e
 * messaggi a nome dell'utente. Generato al primo avvio, 0600.
 *
 * Con `LKSQ_NO_AUTH=1` l'autenticazione è disattivata (solo per debug).
 */
export function getAuthToken(): string | null {
  if (process.env.LKSQ_NO_AUTH === '1') return null;
  if (existsSync(paths.token)) {
    const t = readFileSync(paths.token, 'utf8').trim();
    if (t) return t;
  }
  ensureDataDir();
  const token = randomBytes(24).toString('hex');
  writeFileSync(paths.token, `${token}\n`, { mode: 0o600 });
  return token;
}

/** URL dell'endpoint MCP di questa installazione. */
export function mcpUrl(): string {
  return `http://${appConfig.host}:${appConfig.port}/mcp`;
}

// ============================================================
//  Default di sicurezza — conservativi per account FREE.
//  Vengono salvati nel DB alla prima esecuzione e poi modificati
//  dai tool MCP (`update_safety_settings`).
// ============================================================
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  timezone: appConfig.timezone,
  workingDays: [1, 2, 3, 4, 5], // lun-ven
  workStartHour: 9,
  workEndHour: 18,

  accountAgeDays: null,
  connectionCount: null,

  // Tetto "duro" scelto per prudenza: LinkedIn NON pubblica un limite
  // numerico di inviti. Alzalo solo col tempo e guardando l'acceptance rate.
  weeklyInviteCeiling: 100,

  warmupStartDate: null, // impostata al primo avvio se assente
  rampStartWeekOffset: 0,
  ramp: [
    { week: 1, dailyInvites: 12 }, // ~60/sett
    { week: 2, dailyInvites: 16 }, // ~80/sett
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

  sendNoteOnConnect: false, // FREE: nota -> solo 5 inviti/mese. Personalizza nel 1° messaggio.

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
