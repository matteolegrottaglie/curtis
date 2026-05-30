// ============================================================
//  Login manuale (prima configurazione).
//  Apre il browser, attende che tu acceda a LinkedIn (anche 2FA),
//  salva la sessione nel profilo persistente, poi chiude.
//
//  IMPORTANTE: NON eseguire mentre la dashboard (npm start) è attiva:
//  il profilo del browser può essere usato da un solo processo.
// ============================================================
import { initDb } from '../db/index.js';
import { LinkedInSession } from '../browser/session.js';
import { log } from '../util/log.js';

async function main(): Promise<void> {
  initDb();
  const s = new LinkedInSession();
  await s.launch();
  const ok = await s.waitForManualLogin();
  if (ok) log.info('✅ Login completato. Avvia la dashboard con: npm start');
  else log.error('❌ Login non completato. Riprova: npm run login');
  await s.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  log.error({ err: String(e) }, 'errore login');
  process.exit(1);
});
