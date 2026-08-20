// ============================================================
//  Sessione browser persistente.
//  - Profilo Chrome reale su disco (la sessione LinkedIn resta
//    salvata: login una sola volta, niente token/cookie in chiaro).
//  - In BACKGROUND di default: nessuna finestra che si muove sullo
//    schermo dell'utente. La finestra si apre solo per il login.
//    Non è il vecchio "headless facilmente rilevabile": si usa il Chrome
//    di sistema, si riscrive lo User-Agent per togliere "Headless" e si
//    riproducono i valori del display reale (vedi stealth.ts). Misurato:
//    l'unica differenza residua dal browser visibile era colorDepth.
//  - Login MANUALE (incluso 2FA/checkpoint): non gestiamo password.
// ============================================================
import { chromium, type BrowserContext, type Page } from 'playwright';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { appConfig, paths } from '../config.js';
import { applyStealth } from './stealth.js';
import { log } from '../util/log.js';
import { sleep } from '../util/time.js';
import { randInt } from '../util/rand.js';

const FEED_URL = 'https://www.linkedin.com/feed/';
const LOGIN_URL = 'https://www.linkedin.com/login';

/** Valori autentici osservati a finestra aperta, riusati poi in background. */
interface BrowserHints {
  userAgent?: string;
  colorDepth?: number;
}

function readHints(): BrowserHints {
  try {
    return JSON.parse(readFileSync(paths.browserHints, 'utf8')) as BrowserHints;
  } catch {
    return {};
  }
}

function writeHints(patch: BrowserHints): void {
  try {
    writeFileSync(paths.browserHints, JSON.stringify({ ...readHints(), ...patch }, null, 2));
  } catch {
    // best effort: senza cache si ricalcola al prossimo avvio
  }
}

export class LinkedInSession {
  context: BrowserContext | null = null;
  page: Page | null = null;
  #visible = false;

  /** La finestra del browser è attualmente visibile all'utente? */
  get visible(): boolean {
    return this.#visible;
  }

  /**
   * Avvia il browser nella modalità richiesta.
   *
   * Cambiare modalità richiede di riavviare il contesto: una finestra già
   * aperta non si può nascondere. Portarla fuori schermo con
   * `--window-position` non funziona su macOS — il window server la riporta
   * a bordo schermo (verificato: torna a x:0, y:30).
   */
  async launch(opts: { visible?: boolean } = {}): Promise<void> {
    const visible = opts.visible ?? appConfig.visibleBrowser;
    if (this.context) {
      if (this.#visible === visible) return;
      await this.close();
    }
    await this.#open(visible);
  }

  /** Porta il browser nella modalità richiesta, riavviandolo se necessario. */
  async ensureMode(visible: boolean): Promise<void> {
    await this.launch({ visible });
  }

  async #open(visible: boolean, userAgentOverride?: string): Promise<void> {
    const userDataDir = paths.browserProfile;
    mkdirSync(userDataDir, { recursive: true });
    const hints = readHints();
    const ua = userAgentOverride ?? (visible ? undefined : hints.userAgent);

    this.context = await chromium.launchPersistentContext(userDataDir, {
      headless: !visible,
      channel: appConfig.browserChannel, // 'chrome' o undefined (chromium incluso)
      viewport: { width: 1440, height: 900 },
      locale: 'it-IT',
      timezoneId: appConfig.timezone,
      ...(ua ? { userAgent: ua } : {}),
      args: [
        '--disable-blink-features=AutomationControlled',
        // Senza questo, in background outerWidth non combacia col viewport.
        '--window-size=1440,900',
        ...(visible
          ? ['--start-maximized']
          : [
              // Chrome rallenta timer e rendering delle finestre non visibili:
              // significherebbe azioni che scadono a metà sequenza.
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding',
              '--disable-background-timer-throttling',
            ]),
      ],
    });
    await applyStealth(
      this.context,
      !visible && hints.colorDepth !== undefined ? { colorDepth: hints.colorDepth } : undefined,
    );

    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0]! : await this.context.newPage();
    this.#visible = visible;

    if (visible) {
      // Finestra vera: unico momento in cui si possono osservare i valori
      // autentici di display e User-Agent, da riusare poi in background.
      await this.#captureHints();
    } else if (!userAgentOverride) {
      // Cache assente o invecchiata (Chrome aggiornato): si ricava lo UA
      // corretto e si riapre una volta sola.
      const actual = await this.page.evaluate(() => navigator.userAgent).catch(() => '');
      if (/Headless/i.test(actual)) {
        const fixed = actual.replace(/HeadlessChrome/gi, 'Chrome');
        writeHints({ userAgent: fixed });
        await this.close();
        await this.#open(false, fixed);
        return;
      }
    }

    log.info(
      {
        channel: appConfig.browserChannel ?? 'chromium',
        modalita: visible ? 'finestra visibile' : 'background',
      },
      'browser avviato',
    );
  }

  /** Registra i valori autentici del browser visibile, per usarli in background. */
  async #captureHints(): Promise<void> {
    const observed = await this.page
      ?.evaluate(() => ({ userAgent: navigator.userAgent, colorDepth: screen.colorDepth }))
      .catch(() => null);
    if (!observed) return;
    writeHints({
      userAgent: observed.userAgent.replace(/HeadlessChrome/gi, 'Chrome'),
      colorDepth: observed.colorDepth,
    });
  }

  private requirePage(): Page {
    if (!this.page) throw new Error('sessione browser non avviata');
    return this.page;
  }

  /** Il cookie di sessione `li_at` è la prova di autenticazione di LinkedIn. */
  async hasAuthCookie(): Promise<boolean> {
    const ctx = this.context;
    if (!ctx) return false;
    const cookies = await ctx.cookies('https://www.linkedin.com').catch(() => []);
    return cookies.some((c) => c.name === 'li_at' && !!c.value);
  }

  /** Verifica login: prima il cookie (robusto ai cambi di DOM), poi fallback al feed. */
  async isLoggedIn(): Promise<boolean> {
    if (await this.hasAuthCookie()) return true;
    const page = this.requirePage();
    await page.goto(FEED_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(randInt(1500, 3200));
    const url = page.url();
    if (/\/(login|authwall|checkpoint|signup|uas)/.test(url)) return false;
    const nav = page.locator('#global-nav, .global-nav');
    return await nav
      .first()
      .isVisible({ timeout: 8000 })
      .catch(() => false);
  }

  /**
   * Flusso di login manuale: apre la pagina di login e attende che
   * l'utente completi (anche 2FA), fino a `timeoutMs`.
   */
  async waitForManualLogin(timeoutMs = 5 * 60_000): Promise<boolean> {
    const page = this.requirePage();
    if (await this.isLoggedIn()) {
      log.info('già loggato');
      return true;
    }
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    log.warn('>>> Effettua il login a LinkedIn nella finestra del browser (anche eventuale 2FA). Attendo...');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(3000);
      const url = page.url();
      if (!/\/(login|authwall|checkpoint|signup|uas)/.test(url)) {
        if (await this.isLoggedIn()) {
          log.info('login completato e sessione salvata nel profilo');
          return true;
        }
      }
    }
    log.error('timeout login: riprova `npm run login`');
    return false;
  }

  /** Naviga alla pagina di login di LinkedIn (dove c'è "Continua con Google"). */
  async gotoLogin(): Promise<void> {
    const page = this.page;
    if (!page) return;
    for (let i = 0; i < 2; i++) {
      try {
        await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return;
      } catch {
        await sleep(800);
      }
    }
  }

  /**
   * Verifica PASSIVA del login: NON naviga (così non interrompe il login
   * manuale dell'utente). Controlla tutte le schede aperte e, se ne trova
   * una loggata, la adotta come pagina attiva.
   */
  async isLoggedInPassive(): Promise<boolean> {
    if (!(await this.hasAuthCookie())) return false;
    // adotta una scheda LinkedIn "interna" come pagina attiva per le azioni
    const ctx = this.context;
    if (ctx) {
      for (const p of ctx.pages()) {
        let url = '';
        try {
          url = p.url();
        } catch {
          continue;
        }
        if (/linkedin\.com/i.test(url) && !/\/(login|authwall|checkpoint|signup|uas)/i.test(url)) {
          this.page = p;
          break;
        }
      }
    }
    return true;
  }

  /** Disconnette: cancella i cookie della sessione e torna al login. */
  async clearSession(): Promise<void> {
    await this.context?.clearCookies();
    const page = this.page;
    if (page) await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  /** Prova a leggere il nome dell'account loggato dalla nav (best-effort). */
  async getAccountName(): Promise<string | null> {
    const page = this.page;
    if (!page) return null;
    const img = page.locator('img.global-nav__me-photo').first();
    const alt = await img.getAttribute('alt', { timeout: 3000 }).catch(() => null);
    if (alt && alt.trim()) return alt.replace(/^(foto di|photo of)\s+/i, '').trim();
    return null;
  }

  /** Prova a leggere l'URL della foto profilo LinkedIn dalla nav (best-effort). */
  async getAvatarUrl(): Promise<string | null> {
    const page = this.page;
    if (!page) return null;
    const img = page.locator('img.global-nav__me-photo').first();
    const src = await img.getAttribute('src', { timeout: 3000 }).catch(() => null);
    return src && src.startsWith('http') ? src : null;
  }

  async screenshot(name: string): Promise<string | undefined> {
    const page = this.page;
    if (!page) return undefined;
    const dir = paths.screenshots;
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${name}-${Date.now()}.png`);
    await page.screenshot({ path, fullPage: false }).catch(() => {});
    return path;
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    this.context = null;
    this.page = null;
    this.#visible = false;
  }
}
