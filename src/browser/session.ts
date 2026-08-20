// ============================================================
//  Sessione browser persistente.
//  - Profilo Chrome reale su disco (la sessione LinkedIn resta
//    salvata: login una sola volta, niente token/cookie in chiaro).
//  - Headed di default (headless è molto più rilevabile).
//  - Login MANUALE (incluso 2FA/checkpoint): non gestiamo password.
// ============================================================
import { chromium, type BrowserContext, type Page } from 'playwright';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { appConfig, paths } from '../config.js';
import { applyStealth } from './stealth.js';
import { log } from '../util/log.js';
import { sleep } from '../util/time.js';
import { randInt } from '../util/rand.js';

const FEED_URL = 'https://www.linkedin.com/feed/';
const LOGIN_URL = 'https://www.linkedin.com/login';

export class LinkedInSession {
  context: BrowserContext | null = null;
  page: Page | null = null;

  async launch(): Promise<void> {
    if (this.context) return;
    const userDataDir = paths.browserProfile;
    mkdirSync(userDataDir, { recursive: true });

    this.context = await chromium.launchPersistentContext(userDataDir, {
      headless: !appConfig.headful,
      channel: appConfig.browserChannel, // 'chrome' o undefined (chromium incluso)
      viewport: { width: 1440, height: 900 },
      locale: 'it-IT',
      timezoneId: appConfig.timezone,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--start-maximized',
      ],
    });
    await applyStealth(this.context);

    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0]! : await this.context.newPage();
    log.info({ channel: appConfig.browserChannel ?? 'chromium', headful: appConfig.headful }, 'browser avviato');
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
  }
}
