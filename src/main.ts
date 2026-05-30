// ============================================================
//  Entrypoint: inizializza DB, avvia la dashboard web.
//  L'engine NON parte da solo: lo avvii dalla dashboard
//  (così controlli tu quando il browser si apre e fa azioni).
// ============================================================
import { appConfig } from './config.js';
import { initDb } from './db/index.js';
import { Engine } from './sequencer/engine.js';
import { buildApp } from './server/app.js';
import { log } from './util/log.js';

async function main(): Promise<void> {
  initDb();
  const engine = new Engine();
  const app = buildApp(engine);

  await app.listen({ host: appConfig.host, port: appConfig.port });
  log.info(`🚀 Dashboard: http://${appConfig.host}:${appConfig.port}`);
  log.info('   (l\'engine è fermo: avvialo dalla dashboard quando sei pronto)');

  // Auto-connect: riusa la sessione LinkedIn salvata, così risulti già loggato.
  if (appConfig.autoConnect) {
    log.info('auto-connect: riuso della sessione LinkedIn salvata…');
    void engine.connectSavedSession();
  }

  const shutdown = async (sig: string) => {
    log.info({ sig }, 'arresto in corso...');
    await engine.stop().catch(() => {});
    await app.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
  log.error({ err: String(e) }, 'avvio fallito');
  process.exit(1);
});
