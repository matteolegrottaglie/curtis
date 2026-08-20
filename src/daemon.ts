// ============================================================
//  Daemon: un solo processo che possiede il database, il browser,
//  il motore di sequenza e il server MCP.
//
//  Perché un daemon e non un server MCP che nasce e muore col client:
//   - le campagne durano giorni (attese di accettazione, rampa),
//     quindi il motore deve sopravvivere alla chiusura di Claude Code;
//   - Playwright blocca il profilo browser a un solo processo: se il
//     login, il motore e i tool girassero in processi diversi
//     litigherebbero sulla stessa cartella.
// ============================================================
import { writeFileSync, rmSync } from 'node:fs';
import { appConfig, ensureDataDir, paths, getAuthToken } from './config.js';
import { initDb } from './db/index.js';
import { Engine } from './sequencer/engine.js';
import { buildMcpServer } from './mcp/server.js';
import { KeepAwake } from './platform/keep-awake.js';
import { VERSION } from './version.js';
import { log } from './util/log.js';

export async function runDaemon(): Promise<void> {
  ensureDataDir();
  initDb();

  const engine = new Engine();
  const server = buildMcpServer(engine);
  const { url } = await server.listen();

  writeFileSync(paths.pid, `${process.pid}\n`);
  log.info({ version: VERSION, dataDir: appConfig.dataDir }, 'LinkedIn Sequencer MCP avviato');
  log.info(`🔌 endpoint MCP: ${url}`);
  if (getAuthToken() === null) {
    log.warn('LKSQ_NO_AUTH=1: endpoint MCP SENZA autenticazione. Usalo solo per debug.');
  }

  // Tiene sveglia la macchina solo mentre il motore sta effettivamente lavorando.
  const awake = new KeepAwake();
  const awakeTimer = setInterval(() => {
    if (engine.isRunning() && !awake.active) awake.start();
    else if (!engine.isRunning() && awake.active) awake.stop();
  }, 30_000);
  awakeTimer.unref();

  if (appConfig.autostartEngine) {
    // Avvio non presidiato (servizio di sistema). Finestra oraria, rampa e cap
    // restano attivi: qui si decide solo *quando parte il processo*.
    // Un HALT di sicurezza sopravvive comunque al riavvio: è voluto.
    log.info('autostart: avvio del motore (finestra oraria e limiti restano attivi)');
    void engine.start().catch((e) => log.error({ err: String(e) }, 'autostart fallito'));
  } else if (appConfig.autoConnect) {
    log.info('auto-connect: riuso della sessione LinkedIn salvata…');
    void engine.connectSavedSession();
  }

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ sig }, 'arresto in corso…');
    clearInterval(awakeTimer);
    awake.stop();
    await engine.stop().catch(() => {});
    await server.close().catch(() => {});
    rmSync(paths.pid, { force: true });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
