// ============================================================
//  Comportamento umano: ritardi, digitazione, scroll, click.
//  Niente intervalli fissi, niente raffiche.
// ============================================================
import type { Page, Locator } from 'playwright';
import { gaussianClamped, randInt, chance } from '../util/rand.js';
import { sleep } from '../util/time.js';
import type { SafetyConfig } from '../types.js';

/** Pausa principale tra due azioni "pesanti" (distribuzione ~gaussiana). */
export async function humanPause(cfg: SafetyConfig, multiplier = 1): Promise<void> {
  const ms = gaussianClamped(cfg.delays.betweenActionsMin, cfg.delays.betweenActionsMax) * multiplier;
  await sleep(Math.round(ms));
}

/** Micro-pausa (UI: tra un click e l'altro, attese di reazione). */
export async function shortPause(min = 400, max = 1800): Promise<void> {
  await sleep(randInt(min, max));
}

/** Pausa "di lettura" di una pagina/profilo. */
export async function readingPause(): Promise<void> {
  await sleep(randInt(1800, 6000));
}

/** Pausa lunga "caffè" — ogni tanto, per spezzare il ritmo. */
export async function longBreak(cfg: SafetyConfig): Promise<number> {
  const ms = Math.round(gaussianClamped(cfg.delays.longBreakMin, cfg.delays.longBreakMax));
  await sleep(ms);
  return ms;
}

/** Soglia casuale di azioni dopo cui prendere una pausa lunga. */
export function nextBreakThreshold(cfg: SafetyConfig): number {
  return randInt(cfg.delays.longBreakEveryMin, cfg.delays.longBreakEveryMax);
}

/** Digitazione carattere per carattere con ritmo variabile e pause di pensiero. */
export async function humanType(page: Page, locator: Locator, text: string): Promise<void> {
  await locator.click();
  await shortPause(250, 900);
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: randInt(40, 150) });
    if (chance(0.04)) await sleep(randInt(300, 1300));
  }
  await shortPause(300, 900);
}

/** Scroll naturale verso il basso (con micro-risalite occasionali). */
export async function humanScroll(page: Page, steps = randInt(2, 5)): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, randInt(250, 650));
    await sleep(randInt(400, 1400));
    if (chance(0.2)) {
      await page.mouse.wheel(0, -randInt(80, 220));
      await sleep(randInt(300, 900));
    }
  }
}

/**
 * Hover + micro-pausa + click (più umano del click secco), con
 * fallback che dispatcha il click sull'ELEMENTO invece che sulle
 * coordinate.
 *
 * Perché: la top-nav sticky di LinkedIn (es. il banner "Claim Premium
 * Page for €0") intercetta i pointer event quando il bersaglio resta
 * sotto l'header. Per questo si centra prima l'elemento nel viewport
 * con scrollIntoView({ block: 'center' }) — scrollIntoViewIfNeeded()
 * non basta, lascia il bersaglio proprio sotto la barra.
 *
 * MAI click({ force: true }): force clicca alle COORDINATE, quindi con
 * la top-nav sovrapposta colpisce il banner e porta alla pagina di
 * checkout Premium (successo davvero in test, 2026-08-20). Il fallback
 * qui usa el.click(): niente coordinate, niente elemento sbagliato.
 * Il bersaglio può essere un <div aria-label> dentro un
 * <a role="menuitem">, quindi si clicca l'antenato interattivo.
 */
export async function humanClick(locator: Locator): Promise<void> {
  await locator
    .evaluate((el) => (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' }))
    .catch(() => {});
  await shortPause(400, 1100);
  await locator.hover().catch(() => {});
  await shortPause(200, 700);
  try {
    await locator.click({ timeout: 8000 });
  } catch {
    await locator.evaluate((el) => {
      const target = (el as HTMLElement).closest('a,button,[role="menuitem"]') ?? el;
      (target as HTMLElement).click();
    });
  }
}
