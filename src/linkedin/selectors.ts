// ============================================================
//  Selettori LinkedIn — CENTRALIZZATI perché FRAGILI.
//
//  LinkedIn cambia spesso il DOM e classi offuscate. Qui usiamo
//  preferibilmente ruolo + nome accessibile (regex IT|EN), molto
//  più stabile delle classi CSS. Se qualcosa smette di funzionare,
//  con ogni probabilità va aggiornato SOLO questo file.
//
//  NB: la UI gira in it-IT (vedi session.ts), quindi i nomi sono
//  in italiano con fallback inglese.
// ============================================================
import type { Page, Locator } from 'playwright';

export const RX = {
  connect: /^\s*(collegati|connect)\s*$/i,
  more: /^\s*(altro|more)\s*$/i,
  message: /^\s*(messaggio|message)\s*$/i,
  follow: /^\s*(segui|follow)\s*$/i,
  pending: /(in attesa|pending)/i,
  sendWithoutNote: /(invia senza nota|send without a note|invia ora|send now)/i,
  addNote: /(aggiungi una nota|aggiungi nota|add a note)/i,
  send: /^\s*(invia|send)\s*$/i,
  withdraw: /(ritira|annulla invito|withdraw)/i,
  like: /^\s*(consiglia|mi piace|like)\s*$/i,
  // testo dell'item "Collegati" dentro il menu "Altro"
  connectMenuItem: /(collegati|connect|invita .* a collegarsi|invite .* to connect)/i,
};

/** Bottone "Collegati" nella top-card (potrebbe non esserci: vedi menu Altro). */
export function topCardConnect(page: Page): Locator {
  return page.locator('main').getByRole('button', { name: RX.connect });
}

export function moreButton(page: Page): Locator {
  return page.locator('main').getByRole('button', { name: RX.more }).first();
}

export function messageButton(page: Page): Locator {
  return page.locator('main').getByRole('button', { name: RX.message }).first();
}

export function followButton(page: Page): Locator {
  return page.locator('main').getByRole('button', { name: RX.follow }).first();
}

export function pendingButton(page: Page): Locator {
  return page.locator('main').getByRole('button', { name: RX.pending }).first();
}

// --- modale invito ---
export function sendWithoutNoteButton(page: Page): Locator {
  return page.getByRole('button', { name: RX.sendWithoutNote });
}
export function addNoteButton(page: Page): Locator {
  return page.getByRole('button', { name: RX.addNote });
}
export function noteTextarea(page: Page): Locator {
  return page.locator('textarea[name="message"], #custom-message');
}
export function sendInvitationButton(page: Page): Locator {
  // dentro la dialog
  return page.getByRole('dialog').getByRole('button', { name: RX.send });
}

// --- messaggistica ---
export function messageEditor(page: Page): Locator {
  return page.locator('div.msg-form__contenteditable[contenteditable="true"]').first();
}
export function messageSendButton(page: Page): Locator {
  return page.locator('button.msg-form__send-button, button[type="submit"].msg-form__send-button').first();
}

// --- badge grado di collegamento (1°) per capire se accettato ---
export function firstDegreeBadge(page: Page): Locator {
  return page.locator('main').getByText(/(^|\s)1°($|\s)|grado di collegamento 1|1st degree/i).first();
}
