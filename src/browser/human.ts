// ============================================================
//  Human behaviour: delays, typing, scrolling, clicking.
//  No fixed intervals, no bursts.
// ============================================================
import type { Page, Locator } from 'playwright';
import { gaussianClamped, randInt, chance } from '../util/rand.js';
import { sleep } from '../util/time.js';
import type { SafetyConfig } from '../types.js';

/** Main pause between two "heavy" actions (roughly gaussian distribution). */
export async function humanPause(cfg: SafetyConfig, multiplier = 1): Promise<void> {
  const ms = gaussianClamped(cfg.delays.betweenActionsMin, cfg.delays.betweenActionsMax) * multiplier;
  await sleep(Math.round(ms));
}

/** Micro-pause (UI: between one click and the next, reaction time). */
export async function shortPause(min = 400, max = 1800): Promise<void> {
  await sleep(randInt(min, max));
}

/** "Reading" pause on a page/profile. */
export async function readingPause(): Promise<void> {
  await sleep(randInt(1800, 6000));
}

/** Long "coffee" break — every so often, to break up the rhythm. */
export async function longBreak(cfg: SafetyConfig): Promise<number> {
  const ms = Math.round(gaussianClamped(cfg.delays.longBreakMin, cfg.delays.longBreakMax));
  await sleep(ms);
  return ms;
}

/** Random number of actions after which to take a long break. */
export function nextBreakThreshold(cfg: SafetyConfig): number {
  return randInt(cfg.delays.longBreakEveryMin, cfg.delays.longBreakEveryMax);
}

/** Character-by-character typing with variable rhythm and thinking pauses. */
export async function humanType(page: Page, locator: Locator, text: string): Promise<void> {
  await locator.click();
  await shortPause(250, 900);
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: randInt(40, 150) });
    if (chance(0.04)) await sleep(randInt(300, 1300));
  }
  await shortPause(300, 900);
}

/** Natural downward scrolling (with the occasional small scroll back up). */
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
 * Hover + micro-pause + click (more human than a bare click), with a
 * fallback that dispatches the click on the ELEMENT instead of on
 * coordinates.
 *
 * Why: LinkedIn's sticky top-nav (e.g. the "Claim Premium Page for €0"
 * banner) intercepts pointer events whenever the target sits under the
 * header. That is why the element is first centred in the viewport with
 * scrollIntoView({ block: 'center' }) — scrollIntoViewIfNeeded() is not
 * enough, it leaves the target right under the bar.
 *
 * NEVER click({ force: true }): force clicks at the COORDINATES, so with
 * the top-nav overlapping it hits the banner and lands on the Premium
 * checkout page (it actually succeeded in testing, 2026-08-20). The
 * fallback here uses el.click(): no coordinates, no wrong element.
 * The target may be a <div aria-label> inside an <a role="menuitem">,
 * so we click the interactive ancestor.
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
