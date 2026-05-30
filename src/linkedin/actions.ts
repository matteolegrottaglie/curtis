// ============================================================
//  Azioni LinkedIn (Playwright). Ogni funzione:
//   - naviga e ricontrolla le guardie (captcha/limiti/restrizioni)
//   - usa interazioni "umane" (hover, pause, scroll, typing variabile)
//   - su selettore mancante salva uno screenshot e ritorna 'failed'
//   - su segnale di LinkedIn ritorna 'blocked' + signal (il controller
//     deciderà backoff/halt)
//
//  ATTENZIONE: i selettori (selectors.ts) sono il punto fragile.
//  Validali alla prima esecuzione reale guardando gli screenshot in
//  data/screenshots quando un'azione fallisce.
// ============================================================
import type { ActionResult, Contact } from '../types.js';
import type { LinkedInSession } from '../browser/session.js';
import type { Page } from 'playwright';
import * as S from './selectors.js';
import { detectGuards, inviteLimitModalOpen } from './guards.js';
import * as H from '../browser/human.js';
import { randInt } from '../util/rand.js';

function page(session: LinkedInSession): Page {
  if (!session.page) throw new Error('sessione browser non pronta');
  return session.page;
}

async function open(session: LinkedInSession, url: string): Promise<ActionResult | null> {
  const p = page(session);
  await p.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await H.shortPause(1300, 3000);
  const sig = await detectGuards(p);
  if (sig) return { status: 'blocked', signal: sig, detail: sig.detail };
  return null;
}

const vis = (loc: ReturnType<Page['locator']>, t = 2000) => loc.isVisible({ timeout: t }).catch(() => false);

// ---------------- VISIT ----------------
export async function visitProfile(session: LinkedInSession, contact: Contact): Promise<ActionResult> {
  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;
  await H.humanScroll(page(session), randInt(2, 5));
  await H.readingPause();
  return { status: 'success', detail: 'profilo visitato' };
}

// ---------------- CONNECT ----------------
export async function sendConnectionRequest(
  session: LinkedInSession,
  contact: Contact,
  opts: { note?: string; sendNote: boolean },
): Promise<ActionResult> {
  const p = page(session);
  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;
  await H.humanScroll(p, randInt(1, 3));
  await H.readingPause();

  if (await vis(S.pendingButton(p), 1500)) return { status: 'skipped', detail: 'invito già pendente' };

  let connect = S.topCardConnect(p).first();
  let have = await vis(connect, 2500);
  if (!have) {
    const more = S.moreButton(p);
    if (await vis(more, 2000)) {
      await H.humanClick(more);
      await H.shortPause(500, 1400);
      const item = p
        .getByRole('menuitem', { name: S.RX.connectMenuItem })
        .first()
        .or(p.getByRole('button', { name: S.RX.connectMenuItem }).first());
      if (await vis(item, 2000)) {
        connect = item;
        have = true;
      }
    }
  }
  if (!have) {
    const shot = await session.screenshot('connect-not-found');
    return {
      status: 'failed',
      detail: 'bottone "Collegati" non trovato (già 1° grado? profilo fuori rete?)',
      screenshot: shot,
    };
  }

  await H.humanClick(connect);
  await H.shortPause(900, 2200);

  if (await inviteLimitModalOpen(p)) {
    return {
      status: 'blocked',
      signal: { kind: 'weekly_limit', severity: 2, detail: 'modale limite settimanale' },
      detail: 'limite settimanale inviti',
    };
  }
  const sig = await detectGuards(p);
  if (sig) return { status: 'blocked', signal: sig, detail: sig.detail };

  const dialog = p.getByRole('dialog');
  if (await vis(dialog, 2500)) {
    if (opts.sendNote && opts.note && (await vis(S.addNoteButton(p), 1500))) {
      await H.humanClick(S.addNoteButton(p));
      await H.shortPause(500, 1200);
      await H.humanType(p, S.noteTextarea(p), opts.note);
      await H.shortPause(400, 1100);
      await H.humanClick(S.sendInvitationButton(p).first());
    } else if (await vis(S.sendWithoutNoteButton(p), 1500)) {
      await H.humanClick(S.sendWithoutNoteButton(p).first());
    } else {
      await H.humanClick(S.sendInvitationButton(p).first());
    }
    await H.shortPause(900, 2000);
  }

  const sig2 = await detectGuards(p);
  if (sig2) return { status: 'blocked', signal: sig2, detail: sig2.detail };

  return {
    status: 'success',
    detail: opts.sendNote && opts.note ? 'invito inviato con nota' : 'invito inviato senza nota',
  };
}

// ---------------- MESSAGE (richiede 1° grado) ----------------
export async function sendMessage(session: LinkedInSession, contact: Contact, text: string): Promise<ActionResult> {
  const p = page(session);
  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;
  await H.readingPause();

  const msgBtn = S.messageButton(p);
  if (!(await vis(msgBtn, 3000))) {
    const shot = await session.screenshot('message-btn-not-found');
    return { status: 'failed', detail: 'bottone "Messaggio" non trovato (non sei 1° grado?)', screenshot: shot };
  }
  await H.humanClick(msgBtn);
  await H.shortPause(1200, 2600);

  const editor = S.messageEditor(p);
  if (!(await vis(editor, 4000))) {
    const shot = await session.screenshot('message-editor-not-found');
    return { status: 'failed', detail: 'editor messaggio non trovato', screenshot: shot };
  }
  await H.humanType(p, editor, text);
  await H.shortPause(700, 1700);

  const send = S.messageSendButton(p);
  if (await send.isEnabled().catch(() => false)) {
    await H.humanClick(send);
    await H.shortPause(800, 1800);
    return { status: 'success', detail: 'messaggio inviato' };
  }
  const shot = await session.screenshot('message-send-disabled');
  return { status: 'failed', detail: 'pulsante invio messaggio non disponibile', screenshot: shot };
}

// ---------------- FOLLOW ----------------
export async function followProfile(session: LinkedInSession, contact: Contact): Promise<ActionResult> {
  const p = page(session);
  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;
  await H.readingPause();

  let f = S.followButton(p);
  if (!(await vis(f, 2000))) {
    const more = S.moreButton(p);
    if (await vis(more, 2000)) {
      await H.humanClick(more);
      await H.shortPause(500, 1300);
      const item = p.getByRole('menuitem', { name: S.RX.follow }).first().or(p.getByRole('button', { name: S.RX.follow }).first());
      if (await vis(item, 2000)) f = item;
      else return { status: 'skipped', detail: 'pulsante "Segui" non trovato' };
    } else {
      return { status: 'skipped', detail: 'pulsante "Segui" non trovato' };
    }
  }
  await H.humanClick(f);
  await H.shortPause(600, 1500);
  return { status: 'success', detail: 'follow effettuato' };
}

// ---------------- LIKE post recente (best-effort) ----------------
export async function likeRecentPost(session: LinkedInSession, contact: Contact): Promise<ActionResult> {
  const p = page(session);
  const actUrl = contact.profile_url.replace(/\/+$/, '') + '/recent-activity/all/';
  const blocked = await open(session, actUrl);
  if (blocked) return blocked;
  await H.humanScroll(p, randInt(1, 3));

  const likeBtn = p.getByRole('button', { name: S.RX.like }).first();
  if (!(await vis(likeBtn, 2500))) return { status: 'skipped', detail: 'nessun post recente da apprezzare' };
  await H.humanClick(likeBtn);
  await H.shortPause(600, 1400);
  return { status: 'success', detail: 'like a post recente' };
}

// ---------------- CHECK ACCETTAZIONE ----------------
/** detail: 'accepted' | 'pending' | 'not_connected' | 'unknown' */
export async function checkAccepted(session: LinkedInSession, contact: Contact): Promise<ActionResult> {
  const p = page(session);
  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;

  if (await vis(S.pendingButton(p), 2000)) return { status: 'success', detail: 'pending' };
  if (await vis(S.firstDegreeBadge(p), 2500)) return { status: 'success', detail: 'accepted' };
  if (await vis(S.topCardConnect(p), 2000)) return { status: 'success', detail: 'not_connected' };
  return { status: 'success', detail: 'unknown' };
}

// ---------------- WITHDRAW invito pendente ----------------
export async function withdrawInvite(session: LinkedInSession, contact: Contact): Promise<ActionResult> {
  const p = page(session);
  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;

  const pend = S.pendingButton(p);
  if (!(await vis(pend, 2000))) return { status: 'skipped', detail: 'nessun invito pendente' };
  await H.humanClick(pend);
  await H.shortPause(600, 1500);

  const wd = p.getByRole('dialog').getByRole('button', { name: S.RX.withdraw }).first().or(p.getByRole('button', { name: S.RX.withdraw }).first());
  if (!(await vis(wd, 2500))) {
    const shot = await session.screenshot('withdraw-confirm-not-found');
    return { status: 'failed', detail: 'conferma ritiro non trovata', screenshot: shot };
  }
  await H.humanClick(wd);
  await H.shortPause(600, 1400);
  return { status: 'success', detail: 'invito ritirato' };
}
