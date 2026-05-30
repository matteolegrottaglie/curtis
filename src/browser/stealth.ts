// ============================================================
//  Hardening del fingerprint del browser.
//
//  ONESTÀ: questi accorgimenti RIDUCONO i tell più ovvi
//  dell'automazione, NON rendono invisibili. La difesa vera è
//  comportamentale (ritmo umano + volumi bassi) e di rete
//  (IP residenziale reale = la tua macchina). Usando il Chrome
//  reale con profilo persistente molti di questi valori sono già
//  autentici; qui copriamo solo i segnali più grossolani.
// ============================================================
import type { BrowserContext } from 'playwright';

function stealthInit(): void {
  // navigator.webdriver -> undefined (il tell numero 1)
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // window.chrome presente (come in un Chrome normale)
  const w = window as unknown as { chrome?: unknown };
  if (!w.chrome) w.chrome = { runtime: {} };

  // languages coerenti
  Object.defineProperty(navigator, 'languages', { get: () => ['it-IT', 'it', 'en-US', 'en'] });

  // plugins non vuoti (headless tipicamente ha length 0)
  try {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5].map((i) => ({ name: `Plugin ${i}` })),
    });
  } catch {
    /* alcuni contesti non permettono override: ignora */
  }

  // permissions.query per le notifiche (un classico check anti-bot).
  // Codice iniettato nel browser: usiamo `any` per evitare i tipi DOM stretti.
  const nav = navigator as unknown as {
    permissions?: { query?: (d: { name: string }) => Promise<unknown> };
  };
  if (nav.permissions && nav.permissions.query) {
    const orig = nav.permissions.query.bind(nav.permissions);
    nav.permissions.query = (params: { name: string }) =>
      params && params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : orig(params);
  }
}

export async function applyStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(stealthInit);
}
