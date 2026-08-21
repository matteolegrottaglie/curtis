#!/usr/bin/env node
// ============================================================
//  `curtis` — the command line interface.
//
//  It only covers the lifecycle: install, start, service, health
//  checks. The real work (imports, campaigns, sends) is driven from
//  chat through the MCP tools.
// ============================================================
import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import {
  appConfig,
  dataDirPermissionProblem,
  ensureDataDir,
  authDisabled,
  getAuthToken,
  mcpUrl,
  paths,
} from './config.js';
import { VERSION } from './version.js';
import { installService, installedServicePath, uninstallService } from './platform/service.js';

const CLI_PATH = fileURLToPath(import.meta.url);
const MIN_NODE = [22, 22, 2] as const;

// ------------------------------------------------------------
//  Utilities
// ------------------------------------------------------------
const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const green = (s: string) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s: string) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s: string) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s);

function nodeVersionOk(): boolean {
  const [maj = 0, min = 0, pat = 0] = process.versions.node.split('.').map(Number);
  const [rMaj, rMin, rPat] = MIN_NODE;
  if (maj !== rMaj) return maj > rMaj;
  if (min !== rMin) return min > rMin;
  return pat >= rPat;
}

function daemonPid(): number | null {
  if (!existsSync(paths.pid)) return null;
  const pid = Number(readFileSync(paths.pid, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0); // signal 0: probe for existence without touching the process
    return pid;
  } catch {
    return null;
  }
}

async function health(timeoutMs = 1500): Promise<{ ok: boolean; version?: string }> {
  try {
    const res = await fetch(`http://${appConfig.host}:${appConfig.port}/healthz`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { ok?: boolean; version?: string };
    return { ok: body.ok === true, ...(body.version ? { version: body.version } : {}) };
  } catch {
    return { ok: false };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    // The prompt says [y/N], but the Italian "s/si/sì" is still accepted: no reason to
    // trip up anyone who has been typing it since before the UI switched to English.
    return answer === 'y' || answer === 'yes' || answer === 's' || answer === 'si' || answer === 'sì';
  } finally {
    rl.close();
  }
}

// ------------------------------------------------------------
//  Commands
// ------------------------------------------------------------
const RISK_NOTICE = `
${bold('Before you start — actually read this')}

Automating LinkedIn violates its User Agreement (§8.2). Among the grounds for restriction
LinkedIn explicitly lists "using automation tools to send invitations". The penalty ranges
from a temporary limitation to a permanent ban of the account.

No tool can guarantee it won't happen — not even the paid ones.
This one lowers the risk with low volumes, human pacing and working hours: it doesn't
remove it. You run it on your own account, at your own risk.
`.trim();

async function cmdSetup(args: string[]): Promise<void> {
  const skipPrompt = args.includes('--yes') || args.includes('-y');
  console.log(`\n${bold(`Curtis v${VERSION}`)} — initial setup\n`);
  console.log(RISK_NOTICE);
  console.log();

  if (!existsSync(paths.accepted)) {
    if (!skipPrompt && process.stdin.isTTY) {
      const ok = await confirm('Have you read this and do you accept to proceed at your own risk?');
      if (!ok) {
        console.log('\nSetup cancelled. No files were created.\n');
        process.exit(1);
      }
    }
    ensureDataDir();
    writeFileSync(paths.accepted, `${new Date().toISOString()}\n`);
  }

  ensureDataDir();
  getAuthToken();
  console.log(`${green('✓')} Data directory: ${appConfig.dataDir}`);
  console.log(`${green('✓')} Access token generated in ${paths.token}`);

  const browser = await detectBrowser();
  if (browser.ok) {
    console.log(`${green('✓')} Browser: ${browser.detail}`);
  } else {
    console.log(`${yellow('!')} Browser: ${browser.detail}`);
    console.log(`  Install Google Chrome, or download Playwright's Chromium:`);
    console.log(`    ${bold(browser.fix ?? 'npx playwright install chromium')}`);
  }

  console.log(`\n${bold('Next steps')}`);
  console.log(`  1. Start the daemon:           ${bold('curtis daemon start')}`);
  console.log(`  2. Connect the MCP client:     ${bold('curtis mcp-config')}`);
  console.log(`  3. From chat: "log in to LinkedIn" → the browser opens, sign in by hand once`);
  console.log(`  4. From chat: "import this CSV and start sending the requests"\n`);
  console.log(dim(`  To keep campaigns moving with the client closed: curtis service install\n`));
}

/**
 * Checks the browser that will ACTUALLY be used, not just any browser installed
 * on the system: `curtis doctor` has to fail here, not at the first login.
 */
async function detectBrowser(): Promise<{ ok: boolean; detail: string; fix?: string }> {
  if (appConfig.browserChannel === 'chrome') {
    return { ok: true, detail: 'system Google Chrome' };
  }
  if (appConfig.browserChannel) {
    return { ok: true, detail: `channel "${appConfig.browserChannel}" (from BROWSER_CHANNEL)` };
  }
  try {
    const { chromium } = await import('playwright');
    const exe = chromium.executablePath();
    if (exe && existsSync(exe)) return { ok: true, detail: `Playwright's Chromium (${exe})` };
  } catch {
    // playwright can't resolve the path: treat it as missing
  }
  return {
    ok: false,
    detail: "no usable browser — Chrome isn't installed and Playwright's Chromium was never downloaded",
    fix: 'npx playwright install chromium',
  };
}

async function cmdStart(): Promise<void> {
  if (!nodeVersionOk()) {
    console.error(
      red(`Node ${process.versions.node} is too old: at least ${MIN_NODE.join('.')} is required (mcp-use needs it).`),
    );
    process.exit(1);
  }
  const { runDaemon } = await import('./daemon.js');
  await runDaemon();
}

async function cmdDaemonStart(): Promise<void> {
  if (daemonPid() !== null || (await health()).ok) {
    console.log(`${yellow('!')} The daemon is already running on ${mcpUrl()}`);
    return;
  }
  if (CLI_PATH.endsWith('.ts')) {
    console.error(red('`daemon start` needs the build: run `npm run build`, or use `curtis start` in the foreground.'));
    process.exit(1);
  }

  ensureDataDir();
  appendFileSync(paths.logFile, `\n--- daemon start ${new Date().toISOString()} ---\n`);
  const out = openSync(paths.logFile, 'a');
  const child = spawn(process.execPath, [CLI_PATH, 'start'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  // Same reason as in KeepAwake: a spawn that fails emits 'error', and with no
  // listener Node turns that into an unhandled-error crash — here on top of the
  // "did the daemon come up?" loop below, which would never get to report.
  child.on('error', (e) => {
    console.error(red(`Could not start the daemon process: ${String(e)}`));
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const h = await health();
    if (h.ok) {
      console.log(`${green('✓')} Daemon started (pid ${child.pid}) on ${mcpUrl()}`);
      console.log(dim(`  log: ${paths.logFile}`));
      return;
    }
  }
  console.error(red(`The daemon did not answer within 20s. Check the log: ${paths.logFile}`));
  process.exit(1);
}

async function cmdDaemonStop(): Promise<void> {
  const pid = daemonPid();
  if (pid === null) {
    console.log('No daemon running.');
    return;
  }
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    if (daemonPid() === null) {
      console.log(`${green('✓')} Daemon stopped.`);
      return;
    }
  }
  console.error(yellow(`The daemon (pid ${pid}) hasn't stopped yet. Try again or use: kill -9 ${pid}`));
}

async function cmdDaemonStatus(): Promise<void> {
  const pid = daemonPid();
  const h = await health();
  if (pid !== null && h.ok) {
    console.log(`${green('●')} running — pid ${pid}, ${mcpUrl()}, version ${h.version ?? '?'}`);
  } else if (h.ok) {
    console.log(`${yellow('●')} answering on ${mcpUrl()} but the pid file is not valid`);
  } else if (pid !== null) {
    console.log(`${yellow('●')} process ${pid} is there but not answering on ${mcpUrl()}`);
  } else {
    console.log(`${dim('○')} stopped`);
  }
  console.log(dim(`  data:  ${appConfig.dataDir}`));
  console.log(dim(`  log:   ${paths.logFile}`));
  console.log(
    dim(`  service: ${installedServicePath() ? `installed (${installedServicePath()})` : 'not installed'}`),
  );
}

function cmdLogs(args: string[]): void {
  if (!existsSync(paths.logFile)) {
    console.log(`No log yet: ${paths.logFile}`);
    return;
  }
  const follow = args.includes('-f') || args.includes('--follow');
  const nArg = args.find((a) => /^-n\d+$/.test(a) || /^--lines=\d+$/.test(a));
  const lines = nArg ? Number(nArg.replace(/\D/g, '')) : 60;

  const content = readFileSync(paths.logFile, 'utf8').split('\n');
  console.log(content.slice(-lines).join('\n'));
  if (!follow) return;

  let offset = statSync(paths.logFile).size;
  setInterval(() => {
    let size: number;
    try {
      size = statSync(paths.logFile).size;
    } catch {
      return; // file removed: try again next tick
    }
    if (size < offset) offset = 0; // log truncated or rotated
    if (size <= offset) return;

    const fd = openSync(paths.logFile, 'r');
    try {
      const buf = Buffer.alloc(size - offset);
      const read = readSync(fd, buf, 0, buf.length, offset);
      process.stdout.write(buf.subarray(0, read).toString('utf8'));
      offset += read;
    } finally {
      closeSync(fd);
    }
  }, 700);
}

async function cmdLogin(): Promise<void> {
  if (daemonPid() !== null) {
    console.error(
      red('The daemon is running and owns the browser profile.') +
        '\nLog in from chat with the `linkedin_login` tool, or stop the daemon with `curtis daemon stop` and retry.',
    );
    process.exit(1);
  }
  const { initDb } = await import('./db/index.js');
  const { LinkedInSession } = await import('./browser/session.js');
  initDb();
  const s = new LinkedInSession();
  await s.launch();
  console.log('Sign in to LinkedIn in the browser window that just opened (2FA included). Waiting…');
  const ok = await s.waitForManualLogin();
  await s.close();
  console.log(ok ? `${green('✓')} Login complete: the session stays saved.` : red('✗ Login not completed.'));
  process.exit(ok ? 0 : 1);
}

function cmdMcpConfig(): void {
  const token = getAuthToken();
  const url = mcpUrl();
  console.log(`\n${bold('Claude Code')}`);
  if (token) {
    console.log(
      `  claude mcp add --transport http curtis ${url} \\\n    --header "Authorization: Bearer ${token}"`,
    );
  } else {
    console.log(`  claude mcp add --transport http curtis ${url}`);
  }

  console.log(`\n${bold('Codex')} ${dim('(~/.codex/config.toml)')}`);
  console.log(`  [mcp_servers.curtis]`);
  console.log(`  url = "${url}"`);
  if (token) {
    console.log(`  bearer_token_env_var = "CURTIS_TOKEN"`);
    console.log(`\n  ${dim('and in your shell profile:')}`);
    console.log(`  export CURTIS_TOKEN="${token}"`);
  }
  console.log(`\n${dim(`The token lives in ${paths.token} (0600). Don't share it: it grants access to your LinkedIn account.`)}\n`);
}

async function cmdDoctor(): Promise<void> {
  const checks: { label: string; ok: boolean; detail: string }[] = [];

  checks.push({
    label: 'Node.js',
    ok: nodeVersionOk(),
    detail: `${process.versions.node}${nodeVersionOk() ? '' : ` — needs >= ${MIN_NODE.join('.')}`}`,
  });

  try {
    ensureDataDir();
    // ensureDataDir() tries to chmod 0700 but cannot always succeed, and it
    // does not throw when it fails. Report what is actually on disk: a "✓" on
    // a world-readable data directory is worse than no check at all.
    const permProblem = dataDirPermissionProblem();
    checks.push({
      label: 'Data directory',
      ok: permProblem === null,
      detail: permProblem ?? `${appConfig.dataDir} (0700, owner only)`,
    });
  } catch (e) {
    checks.push({ label: 'Data directory', ok: false, detail: String(e) });
  }

  checks.push({
    label: 'Database',
    ok: true,
    detail: existsSync(paths.db) ? paths.db : `${paths.db} (will be created on first start)`,
  });

  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    checks.push({ label: 'better-sqlite3', ok: true, detail: 'native module loaded' });
  } catch (e) {
    checks.push({
      label: 'better-sqlite3',
      ok: false,
      detail: `${String(e)} — try: npm rebuild better-sqlite3`,
    });
  }

  const browser = await detectBrowser();
  checks.push({
    label: 'Browser',
    ok: browser.ok,
    detail: browser.detail + (browser.fix ? ` → ${browser.fix}` : ''),
  });

  checks.push({
    label: 'LinkedIn session',
    ok: existsSync(paths.browserProfile),
    detail: existsSync(paths.browserProfile)
      ? 'browser profile present (check it is still valid with linkedin_auth_status)'
      : 'never logged in — use `curtis login` or the linkedin_login tool',
  });

  const h = await health();
  const pid = daemonPid();
  checks.push({
    label: 'Daemon',
    ok: h.ok,
    detail: h.ok ? `running on ${mcpUrl()}${pid ? ` (pid ${pid})` : ''}` : `stopped — start it with \`curtis daemon start\``,
  });

  // An endpoint with the token switched off looks exactly like a healthy one
  // from every other check here, and the only trace is a single warn line in
  // daemon.log. This is the one setting where silence is the dangerous answer.
  const noAuth = authDisabled();
  checks.push({
    label: 'Authentication',
    ok: !noAuth,
    detail: noAuth
      ? `DISABLED by CURTIS_NO_AUTH=1 — any process on this machine can send invites and messages as you. Unset it (check ${paths.env}) and restart the daemon.`
      : `bearer token required on ${mcpUrl()}`,
  });

  const svc = installedServicePath();
  checks.push({
    label: 'Service',
    ok: true,
    detail: svc ?? 'not installed (campaigns only advance while the daemon is up)',
  });

  console.log(`\n${bold(`Curtis v${VERSION}`)}\n`);
  for (const c of checks) {
    const mark = c.ok ? green('✓') : yellow('!');
    console.log(`  ${mark} ${c.label.padEnd(20)} ${c.detail}`);
  }
  console.log();
}

async function cmdService(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === 'install') {
    if (CLI_PATH.endsWith('.ts')) {
      console.error(red('Install the service from the compiled package (`npm run build`), not from tsx.'));
      process.exit(1);
    }
    const autostart = !args.includes('--no-autostart');
    console.log(
      autostart
        ? yellow(
            'The service will also start the ENGINE at login: a browser window will open and campaigns\nwill advance on their own inside the configured time window.',
          )
        : 'The service will only keep the daemon up; you start the engine yourself from chat.',
    );
    const steps = installService({ nodePath: process.execPath, cliPath: CLI_PATH, autostartEngine: autostart });
    for (const s of steps) console.log(`  ${green('✓')} ${s}`);
    console.log();
  } else if (sub === 'uninstall') {
    for (const s of uninstallService()) console.log(`  ${green('✓')} ${s}`);
    console.log();
  } else if (sub === 'status') {
    const path = installedServicePath();
    console.log(path ? `installed: ${path}` : 'not installed');
  } else {
    console.error('Usage: curtis service install [--no-autostart] | uninstall | status');
    process.exit(1);
  }
}

function usage(): void {
  console.log(`
${bold(`Curtis v${VERSION}`)}
Runs your LinkedIn outreach from your own machine, driven from chat.

${bold('Commands')}
  curtis setup [--yes]               initial setup (data, token, browser)
  curtis start                       run the daemon in the foreground
  curtis daemon start|stop|status    manage the daemon in the background
  curtis logs [-f] [-n100]           show the daemon log
  curtis login                       LinkedIn login from the terminal (daemon stopped)
  curtis mcp-config                  print the config for Claude Code and Codex
  curtis service install|uninstall|status
                                     install the daemon as a user service
  curtis doctor                      diagnose the installation
  curtis version

${bold('Environment variables')}
  CURTIS_DATA_DIR    data directory (default ~/.curtis)
  CURTIS_PORT        daemon port (default 4311)
  CURTIS_NO_AUTH=1   disable the token on the MCP endpoint (debug only)
  TIMEZONE           timezone of the sending window (default Europe/Rome)
  BROWSER_CHANNEL    'chrome' for the system Chrome, 'chromium' for Playwright's
  HEADFUL            'true' keeps the browser window visible (default: background)
  LOG_LEVEL          trace | debug | info | warn | error | silent (default info)
`);
}


// ------------------------------------------------------------
//  Dispatch
// ------------------------------------------------------------
async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'setup':
      return cmdSetup(rest);
    case 'start':
      return cmdStart();
    case 'daemon': {
      const sub = rest[0];
      if (sub === 'start') return cmdDaemonStart();
      if (sub === 'stop') return cmdDaemonStop();
      if (sub === 'status' || sub === undefined) return cmdDaemonStatus();
      if (sub === 'logs') return void cmdLogs(rest.slice(1));
      console.error('Usage: curtis daemon start|stop|status|logs');
      process.exit(1);
      return;
    }
    case 'logs':
      return void cmdLogs(rest);
    case 'login':
      return cmdLogin();
    case 'mcp-config':
      return void cmdMcpConfig();
    case 'service':
      return cmdService(rest);
    case 'doctor':
      return cmdDoctor();
    case 'version':
    case '--version':
    case '-v':
      return void console.log(VERSION);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return void usage();
    default:
      console.error(`Unknown command: ${cmd}\n`);
      usage();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
