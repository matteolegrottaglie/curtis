// ============================================================
//  Anti-ban guards: they detect LinkedIn's signals.
//  They run after every navigation/action. When a signal fires,
//  the engine hands it to the controller (backoff/halt).
// ============================================================
import type { Page } from 'playwright';
import type { SignalKind } from '../types.js';

export interface DetectedSignal {
  kind: SignalKind;
  severity: number;
  detail?: string;
}

/**
 * Scans the current page for challenges/restrictions/limits.
 * Returns the most severe signal found, or null.
 */
export async function detectGuards(page: Page): Promise<DetectedSignal | null> {
  const url = page.url();

  // 1) Captcha / security checkpoint (from the URL: the most reliable).
  //    Any /checkpoint/ counts: challenge, challengesV2, lg, ...
  if (/\/checkpoint\/|\/captcha|add-phone|two-step/i.test(url)) {
    return { kind: 'captcha', severity: 3, detail: `checkpoint url: ${url}` };
  }

  // 2) Page text (the main chunk of it, with a short timeout)
  let text = '';
  try {
    text = await page.locator('body').innerText({ timeout: 2500 });
  } catch {
    return null;
  }
  text = text.slice(0, 8000);

  if (/(limite settimanale di inviti|weekly invitation limit|reached the weekly invitation|hai raggiunto il limite settimanale)/i.test(text)) {
    return { kind: 'weekly_limit', severity: 2, detail: 'weekly invite limit reached' };
  }
  if (
    /(il tuo account è stato (temporaneamente )?limitato|abbiamo limitato il tuo account|your account has been restricted|we[' ]ve restricted|account temporarily restricted)/i.test(
      text,
    )
  ) {
    return { kind: 'restriction', severity: 3, detail: 'account restricted/suspended' };
  }
  // Device verification / 2FA: LinkedIn asks you to approve the sign-in
  // from the app or to type in a code. It is NOT always served on a
  // /checkpoint/ URL — it can show up as an interstitial on the very
  // same page, and without this check it slipped by unnoticed,
  // producing a banal 'failed' action instead of a block.
  // It needs a human: severity 3 just like the captcha (-> HALT).
  if (
    /(controlla la tua app linkedin|check your linkedin app|apri l'app linkedin|open your linkedin app|approva (questo )?accesso|approve (this )?sign[- ]?in|verifica in due passaggi|two[- ]step verification|inserisci il codice|enter the (\d+[- ]digit )?code|codice di verifica|verification code|verifica del dispositivo|device verification|conferma la tua identità|confirm your identity|verifica che sei tu|verify it'?s you|let'?s do a quick)/i.test(
      text,
    )
  ) {
    return { kind: 'captcha', severity: 3, detail: 'device/2FA verification required (approve in the app or enter the code)' };
  }
  if (/(verifica di sicurezza|security verification|conferma di essere un|are you a human|completa questa verifica)/i.test(text)) {
    return { kind: 'captcha', severity: 3, detail: 'security verification required' };
  }
  if (/(attività insolita|unusual activity|abbiamo notato attività)/i.test(text)) {
    return { kind: 'warning', severity: 2, detail: 'unusual-activity notice detected' };
  }

  return null;
}

/** Is there an invite-limit modal open after clicking "Connect"? */
export async function inviteLimitModalOpen(page: Page): Promise<boolean> {
  try {
    const dialog = page.getByRole('dialog');
    if (!(await dialog.isVisible({ timeout: 1500 }).catch(() => false))) return false;
    const t = await dialog.innerText({ timeout: 1500 }).catch(() => '');
    return /(limite settimanale|weekly invitation limit|riprova più tardi|try again later)/i.test(t);
  } catch {
    return false;
  }
}
