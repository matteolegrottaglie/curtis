// ============================================================
//  Azioni LinkedIn (Playwright). Ogni funzione:
//   - naviga e ricontrolla le guardie (captcha/limiti/restrizioni)
//   - usa interazioni "umane" (hover, pause, scroll, typing variabile)
//   - su selettore mancante salva uno screenshot e ritorna 'failed'
//   - su segnale di LinkedIn ritorna 'blocked' + signal (il controller
//     deciderà backoff/halt)
//
//  RISCRITTO il 2026-08-20 sopra i selettori per aria-label ancorati
//  al nome (vedi selectors.ts). Implementazione di riferimento e
//  verificata sul campo: scripts/connect-no-note.ts.
//
//  DUE INVARIANTI DI SICUREZZA, non toglierle:
//   1. Nessuna azione se non si riesce ad ancorare l'aria-label al
//      nome del contatto: altrimenti si clicca il "Connect" di un
//      profilo della sidebar "More profiles for you".
//   2. Dopo ogni click si controlla di non essere finiti su
//      Premium/checkout (RX.offProfileUrl): ci si ferma e basta.
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

/**
 * Il click ci ha portati fuori dal profilo (upsell Premium/checkout)?
 * Se sì ci si ferma: non si tocca più nulla su quella pagina.
 */
function strayedOffProfile(p: Page): ActionResult | null {
  const url = p.url();
  if (!S.RX.offProfileUrl.test(url)) return null;
  return { status: 'failed', detail: `finito su pagina Premium/checkout (${url}) — mi fermo, nessuna altra azione` };
}

/** Senza token del nome non si clicca niente: vedi invariante 1. */
function unanchored(contact: Contact, what: string): ActionResult {
  return {
    status: 'failed',
    detail: `impossibile ancorare "${what}" al nome di ${contact.profile_url}: senza nome utilizzabile rischierei di cliccare il controllo di un altro profilo (sidebar) — nessuna azione`,
  };
}

/** Apre il menu "Altro" della top-card. Alcuni profili tengono "Collegati" solo lì. */
async function openMoreMenu(p: Page): Promise<boolean> {
  const more = S.moreButton(p);
  if (!(await vis(more, 3000))) return false;
  await H.humanClick(more);
  await H.shortPause(1200, 2200);
  return true;
}

/**
 * Probe della top-card, con fallback dentro il menu "Altro".
 * I label dei due probe vengono FUSI: nella top-card si vede
 * "Message/Follow", nel menu compare "Remove your connection" — la
 * diagnostica di un fallimento le vuole tutte e due.
 */
async function probeWithMoreMenu(p: Page, tokens: string[], timeoutMs = 15_000): Promise<S.TopCardProbe> {
  const probe = await S.probeTopCard(p, tokens, timeoutMs);
  if (probe.kind !== 'none') return probe;
  if (!(await openMoreMenu(p))) return probe;
  const inMenu = await S.probeTopCard(p, tokens, 10_000);
  return {
    kind: inMenu.kind, // probe.kind qui è per forza 'none'
    label: inMenu.label,
    labels: { ...probe.labels, ...inMenu.labels },
    sample: inMenu.sample.length > 0 ? inMenu.sample : probe.sample,
  };
}

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
  const tokens = S.tokensForContact(contact);
  if (tokens.length === 0) return unanchored(contact, 'Collegati');

  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;
  await H.humanScroll(p, randInt(1, 2));

  const probe = await probeWithMoreMenu(p, tokens, 20_000);

  if (probe.kind === 'pending') {
    return { status: 'skipped', detail: `invito già pendente ("${probe.labels.pending}")` };
  }
  if (probe.kind === 'none') {
    const shot = await session.screenshot('connect-not-found');
    return {
      status: 'failed',
      detail:
        `nessun "Invite … to connect" per [${tokens.join(' ')}] né in top-card né nel menu "Altro"` +
        (probe.labels.connected ? ' — sembra già un collegamento di 1° grado' : '') +
        `; aria-label viste: ${JSON.stringify(probe.sample)}`,
      screenshot: shot,
    };
  }

  await H.readingPause();
  await H.humanClick(S.byExactLabel(p, probe.label!));
  await H.shortPause(1500, 2800);

  const strayed = strayedOffProfile(p);
  if (strayed) return strayed;

  if (await inviteLimitModalOpen(p)) {
    return {
      status: 'blocked',
      signal: { kind: 'weekly_limit', severity: 2, detail: 'modale limite settimanale' },
      detail: 'limite settimanale inviti',
    };
  }
  const sig = await detectGuards(p);
  if (sig) return { status: 'blocked', signal: sig, detail: sig.detail };

  // --- modale invito: con nota solo se richiesto, altrimenti SENZA ---
  if (opts.sendNote && opts.note && (await vis(S.addNoteControl(p), 2000))) {
    await H.humanClick(S.addNoteControl(p));
    await H.shortPause(500, 1200);
    await H.humanType(p, S.noteTextarea(p), opts.note);
    await H.shortPause(400, 1100);
    await H.humanClick(S.sendInviteControl(p));
  } else if (await vis(S.sendWithoutNoteControl(p), 6000)) {
    await H.humanClick(S.sendWithoutNoteControl(p));
  } else if (await vis(S.sendInviteControl(p), 3000)) {
    await H.humanClick(S.sendInviteControl(p));
  }
  await H.shortPause(1500, 3000);

  const sig2 = await detectGuards(p);
  if (sig2) return { status: 'blocked', signal: sig2, detail: sig2.detail };

  // --- verifica reale: per questa persona deve comparire "Pending" ---
  const after = await S.probeTopCard(p, tokens, 15_000);
  if (after.kind === 'pending') {
    return {
      status: 'success',
      detail: `${opts.sendNote && opts.note ? 'invito inviato con nota' : 'invito inviato senza nota'} — CONFERMATO ("${after.labels.pending}")`,
    };
  }

  // Non confermato: si ritorna 'failed' apposta. Al retry il probe
  // rivede lo stato: se l'invito era passato trova "Pending" e la
  // richiesta viene saltata, quindi non si manda nulla due volte.
  const shot = await session.screenshot('connect-unconfirmed');
  return {
    status: 'failed',
    detail: `cliccato ma "Pending" non rilevato per [${tokens.join(' ')}]; aria-label viste: ${JSON.stringify(after.sample)}`,
    screenshot: shot,
  };
}

// ---------------- MESSAGE (richiede 1° grado) ----------------
export async function sendMessage(session: LinkedInSession, contact: Contact, text: string): Promise<ActionResult> {
  const p = page(session);
  const tokens = S.tokensForContact(contact);
  if (tokens.length === 0) return unanchored(contact, 'Messaggio');

  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;
  await H.readingPause();

  const probe = await S.probeTopCard(p, tokens, 15_000);
  if (!probe.labels.message) {
    const shot = await session.screenshot('message-btn-not-found');
    return {
      status: 'failed',
      detail: `controllo "Messaggio" non trovato per [${tokens.join(' ')}] (non sei 1° grado?); aria-label viste: ${JSON.stringify(probe.sample)}`,
      screenshot: shot,
    };
  }
  await H.humanClick(S.byExactLabel(p, probe.labels.message));
  await H.shortPause(1200, 2600);

  const strayed = strayedOffProfile(p);
  if (strayed) return strayed;

  const editor = S.messageEditor(p);
  if (!(await vis(editor, 5000))) {
    const shot = await session.screenshot('message-editor-not-found');
    return { status: 'failed', detail: 'editor messaggio non trovato', screenshot: shot };
  }
  await H.humanType(p, editor, text);
  await H.shortPause(700, 1700);

  const send = S.messageSendButton(p);
  if (await vis(send, 3000)) {
    await H.humanClick(send);
    await H.shortPause(800, 1800);
    const sig = await detectGuards(p);
    if (sig) return { status: 'blocked', signal: sig, detail: sig.detail };
    return { status: 'success', detail: 'messaggio inviato' };
  }
  const shot = await session.screenshot('message-send-disabled');
  return { status: 'failed', detail: 'pulsante invio messaggio non disponibile', screenshot: shot };
}

// ---------------- FOLLOW ----------------
export async function followProfile(session: LinkedInSession, contact: Contact): Promise<ActionResult> {
  const p = page(session);
  const tokens = S.tokensForContact(contact);
  if (tokens.length === 0) return unanchored(contact, 'Segui');

  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;
  await H.readingPause();

  let probe = await S.probeTopCard(p, tokens, 15_000);
  // "Segui" spesso non è nella top-card: sta nel menu "Altro".
  if (!probe.labels.follow && (await openMoreMenu(p))) {
    const inMenu = await S.probeTopCard(p, tokens, 10_000);
    if (inMenu.labels.follow) probe = inMenu;
  }
  if (!probe.labels.follow) {
    return {
      status: 'skipped',
      detail: `controllo "Segui" non trovato per [${tokens.join(' ')}]; aria-label viste: ${JSON.stringify(probe.sample)}`,
    };
  }

  await H.humanClick(S.byExactLabel(p, probe.labels.follow));
  await H.shortPause(600, 1500);
  const strayed = strayedOffProfile(p);
  if (strayed) return strayed;
  return { status: 'success', detail: 'follow effettuato' };
}

// ---------------- LIKE post recente (best-effort) ----------------
export async function likeRecentPost(session: LinkedInSession, contact: Contact): Promise<ActionResult> {
  const p = page(session);
  const actUrl = contact.profile_url.replace(/\/+$/, '') + '/recent-activity/all/';
  const blocked = await open(session, actUrl);
  if (blocked) return blocked;
  await H.humanScroll(p, randInt(1, 3));

  const likeBtn = S.likeControl(p);
  if (!(await vis(likeBtn, 2500))) return { status: 'skipped', detail: 'nessun post recente da apprezzare' };
  await H.humanClick(likeBtn);
  await H.shortPause(600, 1400);
  const strayed = strayedOffProfile(p);
  if (strayed) return strayed;
  return { status: 'success', detail: 'like a post recente' };
}

// ---------------- CHECK ACCETTAZIONE ----------------
/** detail: 'accepted' | 'pending' | 'not_connected' | 'unknown' */
export async function checkAccepted(session: LinkedInSession, contact: Contact): Promise<ActionResult> {
  const p = page(session);
  const tokens = S.tokensForContact(contact);
  if (tokens.length === 0) return { status: 'success', detail: 'unknown' };

  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;

  const probe = await S.probeTopCard(p, tokens, 15_000);
  if (probe.kind === 'pending') return { status: 'success', detail: 'pending' };
  if (probe.kind === 'connect') return { status: 'success', detail: 'not_connected' };
  // Niente invito in ballo e c'è un "Messaggia <Nome>": è un 1° grado.
  if (probe.labels.message) return { status: 'success', detail: 'accepted' };

  // Ultima parola al menu "Altro": "Collegati" (fuori rete) oppure
  // "Rimuovi il collegamento" (accettato).
  if (await openMoreMenu(p)) {
    const inMenu = await S.probeTopCard(p, tokens, 10_000);
    if (inMenu.kind === 'pending') return { status: 'success', detail: 'pending' };
    if (inMenu.kind === 'connect') return { status: 'success', detail: 'not_connected' };
    if (inMenu.labels.connected || inMenu.labels.message) return { status: 'success', detail: 'accepted' };
    await p.keyboard.press('Escape').catch(() => {});
  }
  return { status: 'success', detail: 'unknown' };
}

// ---------------- WITHDRAW invito pendente ----------------
export async function withdrawInvite(session: LinkedInSession, contact: Contact): Promise<ActionResult> {
  const p = page(session);
  const tokens = S.tokensForContact(contact);
  if (tokens.length === 0) return unanchored(contact, 'Ritira invito');

  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;

  const probe = await S.probeTopCard(p, tokens, 15_000);
  if (probe.kind !== 'pending') return { status: 'skipped', detail: 'nessun invito pendente' };

  await H.humanClick(S.byExactLabel(p, probe.labels.pending!));
  await H.shortPause(600, 1500);
  const strayed = strayedOffProfile(p);
  if (strayed) return strayed;

  const confirm = S.withdrawConfirmControl(p);
  if (!(await vis(confirm, 3000))) {
    const shot = await session.screenshot('withdraw-confirm-not-found');
    return { status: 'failed', detail: 'conferma ritiro non trovata', screenshot: shot };
  }
  await H.humanClick(confirm);
  await H.shortPause(1200, 2200);

  // Verifica reale: "Pending" deve essere sparito.
  const after = await S.probeTopCard(p, tokens, 10_000);
  if (after.kind === 'pending') {
    const shot = await session.screenshot('withdraw-unconfirmed');
    return { status: 'failed', detail: 'ritiro non confermato: "Pending" ancora presente', screenshot: shot };
  }
  return { status: 'success', detail: 'invito ritirato' };
}
