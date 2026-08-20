#!/usr/bin/env node
// ============================================================
//  `lksq` — interfaccia a riga di comando.
//
//  Serve solo per il ciclo di vita: installazione, avvio, servizio,
//  diagnosi. Il lavoro vero (import, campagne, invii) si comanda da
//  chat attraverso i tool MCP.
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
import { appConfig, ensureDataDir, getAuthToken, mcpUrl, paths } from './config.js';
import { VERSION } from './version.js';
import { installService, isServiceInstalled, servicePath, uninstallService } from './platform/service.js';

const CLI_PATH = fileURLToPath(import.meta.url);
const MIN_NODE = [22, 22, 2] as const;

// ------------------------------------------------------------
//  Utility
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
    process.kill(pid, 0); // segnale 0: verifica esistenza senza toccare il processo
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
    const answer = (await rl.question(`${question} [s/N] `)).trim().toLowerCase();
    return answer === 's' || answer === 'si' || answer === 'sì' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

// ------------------------------------------------------------
//  Comandi
// ------------------------------------------------------------
const RISK_NOTICE = `
${bold('Prima di iniziare — leggi davvero questo')}

Automatizzare LinkedIn viola il suo User Agreement (§8.2). Fra i motivi di restrizione
LinkedIn cita esplicitamente "using automation tools to send invitations". La sanzione
va dalla limitazione temporanea al ban permanente dell'account.

Nessuno strumento può garantire che non succeda — nemmeno quelli a pagamento.
Questo riduce il rischio con volumi bassi, ritmo umano e orari lavorativi: non lo azzera.
Lo usi sul tuo account, a tuo rischio.
`.trim();

async function cmdSetup(args: string[]): Promise<void> {
  const skipPrompt = args.includes('--yes') || args.includes('-y');
  console.log(`\n${bold(`LinkedIn Sequencer MCP v${VERSION}`)} — configurazione iniziale\n`);
  console.log(RISK_NOTICE);
  console.log();

  if (!existsSync(paths.accepted)) {
    if (!skipPrompt && process.stdin.isTTY) {
      const ok = await confirm('Hai letto e accetti di procedere a tuo rischio?');
      if (!ok) {
        console.log('\nConfigurazione annullata. Nessun file creato.\n');
        process.exit(1);
      }
    }
    ensureDataDir();
    writeFileSync(paths.accepted, `${new Date().toISOString()}\n`);
  }

  ensureDataDir();
  getAuthToken();
  console.log(`${green('✓')} Directory dati: ${appConfig.dataDir}`);
  console.log(`${green('✓')} Token di accesso generato in ${paths.token}`);

  const browser = await detectBrowser();
  if (browser.ok) {
    console.log(`${green('✓')} Browser: ${browser.detail}`);
  } else {
    console.log(`${yellow('!')} Browser: ${browser.detail}`);
    console.log(`  Installa Google Chrome, oppure scarica il Chromium di Playwright:`);
    console.log(`    ${bold(browser.fix ?? 'npx playwright install chromium')}`);
  }

  console.log(`\n${bold('Prossimi passi')}`);
  console.log(`  1. Avvia il daemon:            ${bold('lksq daemon start')}`);
  console.log(`  2. Collega il client MCP:      ${bold('lksq mcp-config')}`);
  console.log(`  3. Da chat: "accedi a LinkedIn" → si apre il browser, accedi a mano una volta`);
  console.log(`  4. Da chat: "importa questo CSV e comincia a mandare le richieste"\n`);
  console.log(dim(`  Per far avanzare le campagne anche a client chiuso: lksq service install\n`));
}

/**
 * Verifica il browser che verrà DAVVERO usato, non uno qualsiasi presente
 * sul sistema: `lksq doctor` deve fallire qui, non al primo login.
 */
async function detectBrowser(): Promise<{ ok: boolean; detail: string; fix?: string }> {
  if (appConfig.browserChannel === 'chrome') {
    return { ok: true, detail: 'Google Chrome di sistema' };
  }
  if (appConfig.browserChannel) {
    return { ok: true, detail: `canale "${appConfig.browserChannel}" (da BROWSER_CHANNEL)` };
  }
  try {
    const { chromium } = await import('playwright');
    const exe = chromium.executablePath();
    if (exe && existsSync(exe)) return { ok: true, detail: `Chromium di Playwright (${exe})` };
  } catch {
    // playwright non riesce a risolvere il percorso: trattalo come mancante
  }
  return {
    ok: false,
    detail: 'nessun browser utilizzabile — Chrome non è installato e il Chromium di Playwright non è stato scaricato',
    fix: 'npx playwright install chromium',
  };
}

async function cmdStart(): Promise<void> {
  if (!nodeVersionOk()) {
    console.error(
      red(`Node ${process.versions.node} è troppo vecchio: serve almeno ${MIN_NODE.join('.')} (mcp-use lo richiede).`),
    );
    process.exit(1);
  }
  const { runDaemon } = await import('./daemon.js');
  await runDaemon();
}

async function cmdDaemonStart(): Promise<void> {
  if (daemonPid() !== null || (await health()).ok) {
    console.log(`${yellow('!')} Il daemon è già in esecuzione su ${mcpUrl()}`);
    return;
  }
  if (CLI_PATH.endsWith('.ts')) {
    console.error(red('`daemon start` richiede il build: esegui `npm run build`, oppure usa `lksq start` in foreground.'));
    process.exit(1);
  }

  ensureDataDir();
  appendFileSync(paths.logFile, `\n--- avvio daemon ${new Date().toISOString()} ---\n`);
  const out = openSync(paths.logFile, 'a');
  const child = spawn(process.execPath, [CLI_PATH, 'start'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const h = await health();
    if (h.ok) {
      console.log(`${green('✓')} Daemon avviato (pid ${child.pid}) su ${mcpUrl()}`);
      console.log(dim(`  log: ${paths.logFile}`));
      return;
    }
  }
  console.error(red(`Il daemon non ha risposto entro 20s. Guarda il log: ${paths.logFile}`));
  process.exit(1);
}

async function cmdDaemonStop(): Promise<void> {
  const pid = daemonPid();
  if (pid === null) {
    console.log('Nessun daemon in esecuzione.');
    return;
  }
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    if (daemonPid() === null) {
      console.log(`${green('✓')} Daemon fermato.`);
      return;
    }
  }
  console.error(yellow(`Il daemon (pid ${pid}) non si è ancora fermato. Riprova o usa: kill -9 ${pid}`));
}

async function cmdDaemonStatus(): Promise<void> {
  const pid = daemonPid();
  const h = await health();
  if (pid !== null && h.ok) {
    console.log(`${green('●')} attivo — pid ${pid}, ${mcpUrl()}, versione ${h.version ?? '?'}`);
  } else if (h.ok) {
    console.log(`${yellow('●')} risponde su ${mcpUrl()} ma il pid file non è valido`);
  } else if (pid !== null) {
    console.log(`${yellow('●')} processo ${pid} presente ma non risponde su ${mcpUrl()}`);
  } else {
    console.log(`${dim('○')} fermo`);
  }
  console.log(dim(`  dati:  ${appConfig.dataDir}`));
  console.log(dim(`  log:   ${paths.logFile}`));
  console.log(
    dim(`  servizio: ${isServiceInstalled() ? `installato (${servicePath()})` : 'non installato'}`),
  );
}

function cmdLogs(args: string[]): void {
  if (!existsSync(paths.logFile)) {
    console.log(`Nessun log ancora: ${paths.logFile}`);
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
      return; // file rimosso: riprova al prossimo giro
    }
    if (size < offset) offset = 0; // log troncato o ruotato
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
      red('Il daemon è attivo e possiede il profilo del browser.') +
        '\nAccedi da chat con il tool `linkedin_login`, oppure ferma il daemon con `lksq daemon stop` e riprova.',
    );
    process.exit(1);
  }
  const { initDb } = await import('./db/index.js');
  const { LinkedInSession } = await import('./browser/session.js');
  initDb();
  const s = new LinkedInSession();
  await s.launch();
  console.log('Accedi a LinkedIn nella finestra del browser che si è aperta (anche 2FA). Attendo…');
  const ok = await s.waitForManualLogin();
  await s.close();
  console.log(ok ? `${green('✓')} Login completato: la sessione resta salvata.` : red('✗ Login non completato.'));
  process.exit(ok ? 0 : 1);
}

function cmdMcpConfig(): void {
  const token = getAuthToken();
  const url = mcpUrl();
  console.log(`\n${bold('Claude Code')}`);
  if (token) {
    console.log(
      `  claude mcp add --transport http linkedin-sequencer ${url} \\\n    --header "Authorization: Bearer ${token}"`,
    );
  } else {
    console.log(`  claude mcp add --transport http linkedin-sequencer ${url}`);
  }

  console.log(`\n${bold('Codex')} ${dim('(~/.codex/config.toml)')}`);
  console.log(`  [mcp_servers.linkedin_sequencer]`);
  console.log(`  url = "${url}"`);
  if (token) {
    console.log(`  bearer_token_env_var = "LKSQ_TOKEN"`);
    console.log(`\n  ${dim('e nel tuo profilo di shell:')}`);
    console.log(`  export LKSQ_TOKEN="${token}"`);
  }
  console.log(`\n${dim(`Il token vive in ${paths.token} (0600). Non condividerlo: dà accesso al tuo account LinkedIn.`)}\n`);
}

async function cmdDoctor(): Promise<void> {
  const checks: { label: string; ok: boolean; detail: string }[] = [];

  checks.push({
    label: 'Node.js',
    ok: nodeVersionOk(),
    detail: `${process.versions.node}${nodeVersionOk() ? '' : ` — serve >= ${MIN_NODE.join('.')}`}`,
  });

  try {
    ensureDataDir();
    checks.push({ label: 'Directory dati', ok: true, detail: appConfig.dataDir });
  } catch (e) {
    checks.push({ label: 'Directory dati', ok: false, detail: String(e) });
  }

  checks.push({
    label: 'Database',
    ok: true,
    detail: existsSync(paths.db) ? paths.db : `${paths.db} (verrà creato al primo avvio)`,
  });

  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    checks.push({ label: 'better-sqlite3', ok: true, detail: 'modulo nativo caricato' });
  } catch (e) {
    checks.push({
      label: 'better-sqlite3',
      ok: false,
      detail: `${String(e)} — prova: npm rebuild better-sqlite3`,
    });
  }

  const browser = await detectBrowser();
  checks.push({
    label: 'Browser',
    ok: browser.ok,
    detail: browser.detail + (browser.fix ? ` → ${browser.fix}` : ''),
  });

  checks.push({
    label: 'Sessione LinkedIn',
    ok: existsSync(paths.browserProfile),
    detail: existsSync(paths.browserProfile)
      ? 'profilo browser presente (validità verificabile con linkedin_auth_status)'
      : 'mai effettuato il login — usa `lksq login` o il tool linkedin_login',
  });

  const h = await health();
  const pid = daemonPid();
  checks.push({
    label: 'Daemon',
    ok: h.ok,
    detail: h.ok ? `attivo su ${mcpUrl()}${pid ? ` (pid ${pid})` : ''}` : `fermo — avvialo con \`lksq daemon start\``,
  });

  checks.push({
    label: 'Servizio',
    ok: true,
    detail: isServiceInstalled() ? servicePath() : 'non installato (le campagne avanzano solo a daemon acceso)',
  });

  console.log(`\n${bold(`LinkedIn Sequencer MCP v${VERSION}`)}\n`);
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
      console.error(red('Installa il servizio dal pacchetto compilato (`npm run build`), non da tsx.'));
      process.exit(1);
    }
    const autostart = !args.includes('--no-autostart');
    console.log(
      autostart
        ? yellow(
            'Il servizio avvierà anche il MOTORE al login: si aprirà una finestra del browser e le campagne\navanzeranno da sole dentro la finestra oraria configurata.',
          )
        : 'Il servizio terrà acceso solo il daemon; il motore lo avvii tu da chat.',
    );
    const steps = installService({ nodePath: process.execPath, cliPath: CLI_PATH, autostartEngine: autostart });
    for (const s of steps) console.log(`  ${green('✓')} ${s}`);
    console.log();
  } else if (sub === 'uninstall') {
    for (const s of uninstallService()) console.log(`  ${green('✓')} ${s}`);
    console.log();
  } else if (sub === 'status') {
    console.log(isServiceInstalled() ? `installato: ${servicePath()}` : 'non installato');
  } else {
    console.error('Uso: lksq service install [--no-autostart] | uninstall | status');
    process.exit(1);
  }
}

function usage(): void {
  console.log(`
${bold(`LinkedIn Sequencer MCP v${VERSION}`)}
Server MCP per automatizzare LinkedIn dal tuo computer, comandato da chat.

${bold('Comandi')}
  lksq setup [--yes]              configurazione iniziale (dati, token, browser)
  lksq start                      avvia il daemon in primo piano
  lksq daemon start|stop|status   gestisce il daemon in background
  lksq logs [-f] [-n100]          mostra il log del daemon
  lksq login                      login LinkedIn da terminale (a daemon fermo)
  lksq mcp-config                 stampa la configurazione per Claude Code e Codex
  lksq service install|uninstall|status
                                  installa il daemon come servizio dell'utente
  lksq doctor                     diagnosi dell'installazione
  lksq version

${bold('Variabili d\'ambiente')}
  LKSQ_DATA_DIR   directory dati (default ~/.linkedin-sequencer-mcp)
  LKSQ_PORT       porta del daemon (default 4311)
  LKSQ_NO_AUTH=1  disattiva il token sull'endpoint MCP (solo debug)
  TIMEZONE        fuso della finestra oraria (default Europe/Rome)
  BROWSER_CHANNEL 'chrome' per usare Chrome di sistema, 'chromium' per quello di Playwright
  HEADFUL         'true' per tenere visibile la finestra (default: lavora in background)
  LOG_LEVEL       trace | debug | info | warn | error | silent (default info)
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
      console.error('Uso: lksq daemon start|stop|status|logs');
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
      console.error(`Comando sconosciuto: ${cmd}\n`);
      usage();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
