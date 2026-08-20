// ============================================================
//  Configuration: infrastructure + safety defaults.
//
//  The `curtis` binary is installed globally, so the working
//  directory is arbitrary and the data lives in a user directory
//  rather than in `./data`.
//
//  Resolution order: process.env  ->  <dataDir>/.env  ->  defaults.
//
//  Every setting is read through env(), which accepts both the
//  CURTIS_* name and the older LKSQ_* one. The project was called
//  LinkedIn Sequencer before it was called Curtis, and an install
//  that predates the rename must keep working untouched.
// ============================================================
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { SafetyConfig, ControllerState } from './types.js';

/** Expands a leading `~` and returns an absolute path. */
function expandHome(p: string): string {
  return resolve(p.startsWith('~/') || p === '~' ? join(homedir(), p.slice(1)) : p);
}

/**
 * Reads a setting, accepting the current `CURTIS_*` name and the legacy
 * `LKSQ_*` one. The current name wins when both are set.
 */
export function env(name: string): string | undefined {
  const v = process.env[`CURTIS_${name}`]?.trim() || process.env[`LKSQ_${name}`]?.trim();
  return v || undefined;
}

/** Directory used before the project was renamed to Curtis. */
const LEGACY_DATA_DIR = join(homedir(), '.linkedin-sequencer-mcp');

/**
 * Data directory: SQLite DB, browser profile (LinkedIn session), token,
 * screenshots and logs. Overridable with `CURTIS_DATA_DIR`, which is also how
 * you point at a data directory that lives somewhere else.
 *
 * With no override, an existing pre-rename directory keeps being used. The
 * alternative — silently starting from an empty `~/.curtis` — would look like
 * the tool had lost the LinkedIn session, the contacts and the campaign
 * history, and would invite a second login while the old session sat intact
 * one directory over.
 */
function resolveDataDir(): string {
  const override = env('DATA_DIR');
  if (override) return expandHome(override);
  const current = join(homedir(), '.curtis');
  // An *empty* ~/.curtis must not win over a populated pre-rename directory:
  // it is created by anything that so much as touches the path (a stray
  // `mkdir`, a run with CURTIS_DATA_DIR pointed here, a backup tool), and
  // letting its bare existence decide would produce exactly the "everything is
  // gone" screen this fallback exists to prevent. To move to ~/.curtis on
  // purpose, copy the old directory across or point CURTIS_DATA_DIR at the new
  // one — an override always wins.
  if (existsSync(LEGACY_DATA_DIR) && !hasContents(current)) return LEGACY_DATA_DIR;
  return current;
}

/** True when `dir` exists, is a directory, and is not empty. */
function hasContents(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false; // missing, or not a directory
  }
}

export const DATA_DIR: string = resolveDataDir();

/**
 * True when running against a data directory that predates the rename —
 * whether it was picked up by the fallback or named outright. A pre-rename
 * install commonly has `LKSQ_DATA_DIR` exported in a shell profile, and the
 * directory is no less the old one for having been asked for by name.
 */
export const USING_LEGACY_DATA_DIR = DATA_DIR === LEGACY_DATA_DIR;

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
  port: Number(env('PORT') ?? 4311),
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

const octal = (mode: number): string => `0${(mode & 0o7777).toString(8).padStart(3, '0')}`;

/**
 * chmods a directory to 0700 if it currently grants anything to group or other.
 *
 * `mkdirSync`'s `mode` only applies to directories it actually *creates*: on an
 * install made by an earlier version the directory is already there, and the
 * mode argument is silently ignored. So existing ones have to be chmod'd.
 *
 * Tightening is announced, because `CURTIS_DATA_DIR` can point at a pre-existing
 * directory of the user's choosing and changing its permissions behind their
 * back would be rude.
 */
function tightenDir(dir: string): void {
  let before: number;
  try {
    before = statSync(dir).mode & 0o7777;
  } catch {
    return; // does not exist / not reachable: nothing to tighten
  }
  if ((before & 0o077) === 0) return;
  try {
    chmodSync(dir, 0o700);
  } catch {
    // reported by dataDirPermissionProblem(); never fatal on its own
    return;
  }
  warn(`permissions on ${dir} tightened from ${octal(before)} to 0700 (it holds your LinkedIn session)`);
}

/**
 * Whether the data directory still lets other local users in, and why.
 *
 * The files inside are created with the process umask — `sequencer.db` and
 * `daemon.log` land at 0644 — so 0700 on the directory is the *only* thing
 * keeping them private: without execute permission on the directory no other
 * user can resolve a name inside it, whatever the file's own mode says. If the
 * chmod did not take (directory owned by someone else, immutable flag, exFAT /
 * SMB volume with no POSIX modes) that protection is simply absent, and the
 * user has to be told rather than reassured.
 */
export function dataDirPermissionProblem(): string | null {
  let mode: number;
  try {
    mode = statSync(DATA_DIR).mode & 0o7777;
  } catch (e) {
    return `cannot read the permissions of ${DATA_DIR}: ${String(e)}`;
  }
  if ((mode & 0o077) === 0) return null;
  return `${DATA_DIR} is ${octal(mode)}, not 0700: every other user on this machine can read the LinkedIn session (a password equivalent), the contact database and the screenshots. Fix it with: chmod -R go-rwx "${DATA_DIR}"`;
}

let warnedAboutPermissions = false;

/**
 * Creates the data directory, owner-only.
 *
 * It holds the browser profile — the live LinkedIn session, a password
 * equivalent — plus the contact database and the screenshots. On a machine
 * with more than one account the default 0755 would leave all of that
 * readable by every other user, so an existing directory is tightened too.
 */
export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  tightenDir(DATA_DIR);
  // Sub-directories made by an older version kept the default 0755. They are
  // shielded by the 0700 on the parent, but only for as long as that holds —
  // tighten them too instead of relying on a single gate.
  tightenDir(paths.browserProfile);
  tightenDir(paths.screenshots);

  const problem = dataDirPermissionProblem();
  if (problem && !warnedAboutPermissions) {
    warnedAboutPermissions = true;
    warn(problem);
  }
}

/**
 * stderr directly, not the pino logger: config.ts is imported before logging is
 * configured, and this has to be visible even when the daemon is being spawned.
 */
function warn(msg: string): void {
  try {
    process.stderr.write(`[curtis] WARNING: ${msg}\n`);
  } catch {
    // stderr closed (detached daemon): nothing sensible left to do
  }
}

/**
 * Bearer token protecting the local MCP endpoint.
 *
 * It genuinely matters: an HTTP server on loopback is reachable by any
 * process — and by any web page open in the user's browser should the
 * anti DNS-rebinding check fail. Whoever reaches it can send invites and
 * messages in the user's name. Generated on first run, 0600.
 *
 * With `CURTIS_NO_AUTH=1` authentication is disabled (debug only).
 */
export function getAuthToken(): string | null {
  if (env('NO_AUTH') === '1') return null;
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
