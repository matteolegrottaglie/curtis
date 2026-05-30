// ============================================================
//  Guardie anti-ban: rilevano i segnali di LinkedIn.
//  Vengono chiamate dopo ogni navigazione/azione. Se scatta un
//  segnale, l'engine lo passa al controller (backoff/halt).
// ============================================================
import type { Page } from 'playwright';
import type { SignalKind } from '../types.js';

export interface DetectedSignal {
  kind: SignalKind;
  severity: number;
  detail?: string;
}

/**
 * Analizza la pagina corrente per challenge/restrizioni/limiti.
 * Ritorna il segnale più grave trovato, oppure null.
 */
export async function detectGuards(page: Page): Promise<DetectedSignal | null> {
  const url = page.url();

  // 1) Captcha / security checkpoint (dall'URL: il più affidabile)
  if (/checkpoint\/challenge|\/checkpoint\/lg|\/captcha|add-phone|two-step/i.test(url)) {
    return { kind: 'captcha', severity: 3, detail: `checkpoint url: ${url}` };
  }

  // 2) Testo della pagina (porzione principale, con timeout breve)
  let text = '';
  try {
    text = await page.locator('body').innerText({ timeout: 2500 });
  } catch {
    return null;
  }
  text = text.slice(0, 8000);

  if (/(limite settimanale di inviti|weekly invitation limit|reached the weekly invitation|hai raggiunto il limite settimanale)/i.test(text)) {
    return { kind: 'weekly_limit', severity: 2, detail: 'limite settimanale inviti raggiunto' };
  }
  if (
    /(il tuo account è stato (temporaneamente )?limitato|abbiamo limitato il tuo account|your account has been restricted|we[' ]ve restricted|account temporarily restricted)/i.test(
      text,
    )
  ) {
    return { kind: 'restriction', severity: 3, detail: 'account limitato/sospeso' };
  }
  if (/(verifica di sicurezza|security verification|conferma di essere un|are you a human|completa questa verifica)/i.test(text)) {
    return { kind: 'captcha', severity: 3, detail: 'verifica di sicurezza richiesta' };
  }
  if (/(attività insolita|unusual activity|abbiamo notato attività)/i.test(text)) {
    return { kind: 'warning', severity: 2, detail: 'rilevata segnalazione di attività insolita' };
  }

  return null;
}

/** Esiste una modale di limite inviti aperta dopo il click su "Collegati"? */
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
