// ============================================================
//  Daemon: a single process owning the database, the browser,
//  the sequence engine and the MCP server.
//
//  Why a daemon and not an MCP server that lives and dies with the
//  client:
//   - campaigns run for days (waiting for acceptances, the ramp), so
//     the engine has to outlive Claude Code being closed;
//   - Playwright locks the browser profile to a single process: if
//     login, engine and tools ran in different processes they would
//     fight over the same directory.
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
  log.info({ version: VERSION, dataDir: appConfig.dataDir }, 'Curtis started');
  log.info(`🔌 MCP endpoint: ${url}`);
  if (getAuthToken() === null) {
    log.warn('CURTIS_NO_AUTH=1: MCP endpoint with NO authentication. Debugging only.');
  }

  // Keep the machine awake only while the engine is actually working.
  const awake = new KeepAwake();
  const awakeTimer = setInterval(() => {
    if (engine.isRunning() && !awake.active) awake.start();
    else if (!engine.isRunning() && awake.active) awake.stop();
  }, 30_000);
  awakeTimer.unref();

  if (appConfig.autostartEngine) {
    // Unattended start (system service). The working window, the ramp and the
    // caps all stay in force: this only decides *when the process starts*.
    // A safety HALT survives the restart regardless: that is deliberate.
    log.info('autostart: starting the engine (working window and limits stay in force)');
    void engine.start().catch((e) => log.error({ err: String(e) }, 'autostart failed'));
  } else if (appConfig.autoConnect) {
    log.info('auto-connect: reusing the saved LinkedIn session…');
    void engine.connectSavedSession();
  }

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ sig }, 'shutting down…');
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
