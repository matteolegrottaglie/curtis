// ============================================================
//  Browser fingerprint hardening.
//
//  HONESTY: these tweaks REDUCE the most obvious automation
//  tells, they do NOT make you invisible. The real defense is
//  behavioural (human rhythm + low volumes) and network-level
//  (a real residential IP = your own machine). Running the real
//  Chrome with a persistent profile already makes many of these
//  values authentic; here we only cover the coarsest signals.
// ============================================================
import type { BrowserContext } from 'playwright';

/** Real display values to replay when working in background. */
export interface DisplayHints {
  colorDepth: number;
}

function stealthInit(): void {
  // navigator.webdriver -> undefined (tell number one)
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // window.chrome present (as in a normal Chrome)
  const w = window as unknown as { chrome?: unknown };
  if (!w.chrome) w.chrome = { runtime: {} };

  // consistent languages
  Object.defineProperty(navigator, 'languages', { get: () => ['it-IT', 'it', 'en-US', 'en'] });

  // non-empty plugins (headless typically has length 0)
  try {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5].map((i) => ({ name: `Plugin ${i}` })),
    });
  } catch {
    /* some contexts do not allow the override: ignore */
  }

  // permissions.query for notifications (a classic anti-bot check).
  // Code injected into the browser: we use `any` to dodge the strict DOM types.
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

/**
 * In background `screen.colorDepth` drops to 24, while a Mac with a wide-gamut
 * display reports 30: that is the last measurable difference from the visible
 * window (UA and dimensions are already aligned elsewhere). We replay the
 * value observed on the real display, captured during the login.
 */
function displayInit(depth: number): void {
  Object.defineProperty(screen, 'colorDepth', { get: () => depth });
  Object.defineProperty(screen, 'pixelDepth', { get: () => depth });
}

export async function applyStealth(context: BrowserContext, hints?: DisplayHints): Promise<void> {
  await context.addInitScript(stealthInit);
  if (hints) await context.addInitScript(displayInit, hints.colorDepth);
}
