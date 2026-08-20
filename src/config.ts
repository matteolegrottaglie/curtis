// ============================================================
//  Configuration: infrastructure + safety defaults.
//
//  Unlike the original project (a dashboard launched from the repo
//  folder), here the `lksq` binary is installed globally: the
//  working directory is arbitrary, so the data lives in a user
//  directory, not in `./data`.
//
//  Resolution order: process.env  ->  <dataDir>/.env  ->  defaults.
// ============================================================
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { SafetyConfig, ControllerState } from './types.js';

/** Expands a leading `~` and returns an absolute path. */
function expandHome(p: string): string {
  return resolve(p.startsWith('~/') || p === '~' ? join(homedir(), p.slice(1)) : p);
}

/**
 * Data directory: SQLite DB, browser profile (LinkedIn session), token,
 * screenshots and logs. Overridable with `LKSQ_DATA_DIR` — which is also how
 * you reuse the original project's data by pointing at its `./data`.
 */
export const DATA_DIR: string = process.env.LKSQ_DATA_DIR?.trim()
  ? expandHome(process.env.LKSQ_DATA_DIR.trim())
  : join(homedir(), '.linkedin-sequencer-mcp');

// --- mini .env parser (no dependencies) ---
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
    // process.env wins: the file never overrides the environment.
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv(DATA_DIR);

/** Places to look for a system-installed Google Chrome. */
const SYSTEM_CHROME_PATHS: Record<string, string[]> = {
  darwin: ['/Applications/Google Chrome.app'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

/**
 * Which browser Playwright should drive.
 *
 * Without an explicit choice we prefer the **system Chrome** when there is
 * one: the Chromium bundled with Playwright has to be downloaded separately
 * with `playwright install`, and a fresh install does not have it — the first
 * login would fail with an inscrutable error even though Chrome is right
 * there on the Mac. Real Chrome also has a more authentic fingerprint.
 *
 * `BROWSER_CHANNEL=chromium` forces Playwright's own build anyway.
 */
function resolveBrowserChannel(): string | undefined {
  const explicit = process.env.BROWSER_CHANNEL?.trim();
  if (explicit) return explicit === 'chromium' ? undefined : explicit;
  const candidates = SYSTEM_CHROME_PATHS[process.platform] ?? [];
  return candidates.some((p) => existsSync(p)) ? 'chrome' : undefined;
}

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  timezone: string;
  /** Show the browser window while working (login aside). */
  visibleBrowser: boolean;
  browserChannel: string | undefined;
  autoConnect: boolean;
  autostartEngine: boolean;
}

export const appConfig: AppConfig = {
  // The MCP server always stays on loopback: it exposes actions that act on
  // the user's LinkedIn account, it must never listen publicly.
  host: '127.0.0.1',
  port: Number(process.env.LKSQ_PORT ?? 4311),
  dataDir: DATA_DIR,
  timezone: process.env.TIMEZONE ?? 'Europe/Rome',
  // Default: the browser works in the background. The window only opens for
  // login, where the user has to be able to type. With HEADFUL=true it stays
  // visible always (handy for figuring out why a selector isn't matching).
  visibleBrowser: (process.env.HEADFUL ?? 'false') === 'true',
  browserChannel: resolveBrowserChannel(),
  autoConnect: (process.env.AUTO_CONNECT ?? 'true') !== 'false',
  autostartEngine: (process.env.AUTOSTART_ENGINE ?? 'false') === 'true',
};

/** Paths of the service files inside the data dir. */
export const paths = {
  db: join(DATA_DIR, 'sequencer.db'),
  browserProfile: join(DATA_DIR, 'browser-profile'),
  screenshots: join(DATA_DIR, 'screenshots'),
  browserHints: join(DATA_DIR, 'browser-hints.json'),
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
 * Bearer token protecting the local MCP endpoint.
 *
 * It genuinely matters: an HTTP server on loopback is reachable by any
 * process — and by any web page open in the user's browser should the
 * anti DNS-rebinding check fail. Whoever reaches it can send invites and
 * messages in the user's name. Generated on first run, 0600.
 *
 * With `LKSQ_NO_AUTH=1` authentication is disabled (debug only).
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

/** URL of this installation's MCP endpoint. */
export function mcpUrl(): string {
  return `http://${appConfig.host}:${appConfig.port}/mcp`;
}

// ============================================================
//  Safety defaults — conservative, tuned for FREE accounts.
//  They are stored in the DB on first run and edited afterwards
//  through the MCP tools (`update_safety_settings`).
// ============================================================
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  timezone: appConfig.timezone,
  workingDays: [1, 2, 3, 4, 5], // Mon-Fri
  workStartHour: 9,
  workEndHour: 18,

  accountAgeDays: null,
  connectionCount: null,

  // A "hard" ceiling picked out of caution: LinkedIn does NOT publish a
  // numeric invite limit. Raise it only over time, watching the acceptance rate.
  weeklyInviteCeiling: 100,

  warmupStartDate: null, // set on first run if missing
  rampStartWeekOffset: 0,
  ramp: [
    { week: 1, dailyInvites: 12 }, // ~60/week
    { week: 2, dailyInvites: 16 }, // ~80/week
    { week: 3, dailyInvites: 18 },
    { week: 4, dailyInvites: 20 }, // ~100/week (hits the default ceiling)
    { week: 5, dailyInvites: 22 },
    { week: 6, dailyInvites: 25 }, // beyond this you need a higher weeklyInviteCeiling + trust
  ],

  minAcceptanceRate: 0.4,
  backoffFactor: 0.7,
  recoveryStepPct: 0.1,
  backoffCooldownHours: 24,
  cleanDaysToRecover: 3,

  caps: {
    invites: 30, // absolute safety ceiling (the ramp usually stays below it)
    messages: 40,
    visits: 60,
    follows: 25,
    likes: 30,
    withdraws: 20,
  },

  delays: {
    betweenActionsMin: 40_000, // 40s
    betweenActionsMax: 200_000, // ~3.3 min
    longBreakEveryMin: 6, // after 6-12 actions...
    longBreakEveryMax: 12,
    longBreakMin: 8 * 60_000, // ...take an 8-25 min break
    longBreakMax: 25 * 60_000,
  },

  sendNoteOnConnect: false, // FREE: a note -> only 5 invites/month. Personalize in the 1st message.

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
