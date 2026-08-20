// ============================================================
//  Persistent browser session.
//  - Real Chrome profile on disk (the LinkedIn session stays
//    saved: log in once, no plaintext tokens/cookies).
//  - BACKGROUND by default: no window moving around on the
//    user's screen. The window only opens for the login.
//    This is not the old "trivially detectable headless": it uses the
//    system Chrome, rewrites the User-Agent to drop "Headless" and
//    replays the real display's values (see stealth.ts). Measured:
//    the only difference left from the visible browser was colorDepth.
//  - MANUAL login (2FA/checkpoint included): we never handle passwords.
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

/** Authentic values observed with the window open, later reused in background. */
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
    // best effort: without the cache it is recomputed on the next start
  }
}

export class LinkedInSession {
  context: BrowserContext | null = null;
  page: Page | null = null;
  #visible = false;

  /** Is the browser window currently visible to the user? */
  get visible(): boolean {
    return this.#visible;
  }

  /**
   * Start the browser in the requested mode.
   *
   * Switching mode requires restarting the context: a window that is already
   * open cannot be hidden. Pushing it off-screen with `--window-position`
   * does not work on macOS — the window server drags it back to the edge of
   * the screen (verified: it snaps back to x:0, y:30).
   */
  async launch(opts: { visible?: boolean } = {}): Promise<void> {
    const visible = opts.visible ?? appConfig.visibleBrowser;
    if (this.context) {
      if (this.#visible === visible) return;
      await this.close();
    }
    await this.#open(visible);
  }

  /** Bring the browser into the requested mode, restarting it if needed. */
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
      channel: appConfig.browserChannel, // 'chrome' or undefined (bundled chromium)
      viewport: { width: 1440, height: 900 },
      locale: 'it-IT',
      timezoneId: appConfig.timezone,
      ...(ua ? { userAgent: ua } : {}),
      args: [
        '--disable-blink-features=AutomationControlled',
        // Without this, in background outerWidth does not match the viewport.
        '--window-size=1440,900',
        ...(visible
          ? ['--start-maximized']
          : [
              // Chrome throttles timers and rendering for non-visible windows:
              // that would mean actions timing out halfway through a sequence.
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
      // A real window: the only moment when the authentic display and
      // User-Agent values can be observed, to be reused later in background.
      await this.#captureHints();
    } else if (!userAgentOverride) {
      // Cache missing or stale (Chrome got updated): derive the correct UA
      // and reopen exactly once.
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
        mode: visible ? 'visible window' : 'background',
      },
      'browser started',
    );
  }

  /** Record the visible browser's authentic values, to reuse them in background. */
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
    if (!this.page) throw new Error('browser session not started');
    return this.page;
  }

  /** The `li_at` session cookie is LinkedIn's proof of authentication. */
  async hasAuthCookie(): Promise<boolean> {
    const ctx = this.context;
    if (!ctx) return false;
    const cookies = await ctx.cookies('https://www.linkedin.com').catch(() => []);
    return cookies.some((c) => c.name === 'li_at' && !!c.value);
  }

  /** Login check: the cookie first (robust to DOM changes), then a feed fallback. */
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
   * Manual login flow: opens the login page and waits for the user to
   * finish (2FA included), up to `timeoutMs`.
   */
  async waitForManualLogin(timeoutMs = 5 * 60_000): Promise<boolean> {
    const page = this.requirePage();
    if (await this.isLoggedIn()) {
      log.info('already logged in');
      return true;
    }
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    log.warn('>>> Log in to LinkedIn in the browser window (including any 2FA). Waiting...');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(3000);
      const url = page.url();
      if (!/\/(login|authwall|checkpoint|signup|uas)/.test(url)) {
        if (await this.isLoggedIn()) {
          log.info('login completed and session saved in the profile');
          return true;
        }
      }
    }
    log.error('login timed out: try `npm run login` again');
    return false;
  }

  /** Navigate to the LinkedIn login page (the one with "Continue with Google"). */
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
   * PASSIVE login check: does NOT navigate (so it never interrupts the
   * user's manual login). Inspects every open tab and, if it finds a
   * logged-in one, adopts it as the active page.
   */
  async isLoggedInPassive(): Promise<boolean> {
    if (!(await this.hasAuthCookie())) return false;
    // adopt an "inner" LinkedIn tab as the active page for the actions
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

  /** Sign out: clears the session cookies and goes back to the login page. */
  async clearSession(): Promise<void> {
    await this.context?.clearCookies();
    const page = this.page;
    if (page) await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  /** Try to read the logged-in account name from the nav (best-effort). */
  async getAccountName(): Promise<string | null> {
    const page = this.page;
    if (!page) return null;
    const img = page.locator('img.global-nav__me-photo').first();
    const alt = await img.getAttribute('alt', { timeout: 3000 }).catch(() => null);
    if (alt && alt.trim()) return alt.replace(/^(foto di|photo of)\s+/i, '').trim();
    return null;
  }

  /** Try to read the LinkedIn profile photo URL from the nav (best-effort). */
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
