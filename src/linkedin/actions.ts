// ============================================================
//  LinkedIn actions (Playwright). Every function:
//   - navigates and re-checks the guards (captcha/limits/restrictions)
//   - uses "human" interactions (hover, pauses, scroll, variable typing)
//   - on a missing selector saves a screenshot and returns 'failed'
//   - on a LinkedIn signal returns 'blocked' + signal (the controller
//     will decide backoff/halt)
//
//  REWRITTEN on 2026-08-20 on top of the aria-label selectors anchored
//  to the name (see selectors.ts). Reference implementation, verified
//  in the field: scripts/connect-no-note.ts.
//
//  TWO SAFETY INVARIANTS, do not remove them:
//   1. No action at all if the aria-label cannot be anchored to the
//      contact's name: otherwise you click the "Connect" of some
//      profile in the "More profiles for you" sidebar.
//   2. After every click, verify we did not land on Premium/checkout
//      (RX.offProfileUrl): we just stop, full stop.
// ============================================================
import type { ActionResult, Contact } from '../types.js';
import type { LinkedInSession } from '../browser/session.js';
import type { Page } from 'playwright';
import * as S from './selectors.js';
import { detectGuards, inviteLimitModalOpen } from './guards.js';
import * as H from '../browser/human.js';
import { randInt } from '../util/rand.js';

function page(session: LinkedInSession): Page {
  if (!session.page) throw new Error('browser session not ready');
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
 * Did the click take us off the profile (Premium upsell/checkout)?
 * If so we stop: nothing else gets touched on that page.
 */
function strayedOffProfile(p: Page): ActionResult | null {
  const url = p.url();
  if (!S.RX.offProfileUrl.test(url)) return null;
  return { status: 'failed', detail: `ended up on a Premium/checkout page (${url}) — stopping, no further action` };
}

/** Without a token from the name we click nothing: see invariant 1. */
function unanchored(contact: Contact, what: string): ActionResult {
  return {
    status: 'failed',
    detail: `cannot anchor "${what}" to the name of ${contact.profile_url}: with no usable name I would risk clicking another profile's control (sidebar) — no action taken`,
  };
}

/** Opens the top-card "More" menu. Some profiles keep "Connect" only in there. */
async function openMoreMenu(p: Page): Promise<boolean> {
  const more = S.moreButton(p);
  if (!(await vis(more, 3000))) return false;
  await H.humanClick(more);
  await H.shortPause(1200, 2200);
  return true;
}

/**
 * Top-card probe, with a fallback inside the "More" menu.
 * The labels of the two probes get MERGED: the top-card shows
 * "Message/Follow", the menu shows "Remove your connection" — the
 * diagnostics of a failure want both of them.
 */
async function probeWithMoreMenu(p: Page, tokens: string[], timeoutMs = 15_000): Promise<S.TopCardProbe> {
  const probe = await S.probeTopCard(p, tokens, timeoutMs);
  if (probe.kind !== 'none') return probe;
  if (!(await openMoreMenu(p))) return probe;
  const inMenu = await S.probeTopCard(p, tokens, 10_000);
  return {
    kind: inMenu.kind, // probe.kind here is necessarily 'none'
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
  return { status: 'success', detail: 'profile visited' };
}

// ---------------- CONNECT ----------------
export async function sendConnectionRequest(
  session: LinkedInSession,
  contact: Contact,
  opts: { note?: string; sendNote: boolean },
): Promise<ActionResult> {
  const p = page(session);
  const tokens = S.tokensForContact(contact);
  if (tokens.length === 0) return unanchored(contact, 'Connect');

  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;
  await H.humanScroll(p, randInt(1, 2));

  const probe = await probeWithMoreMenu(p, tokens, 20_000);

  if (probe.kind === 'pending') {
    return { status: 'skipped', detail: `invite already pending ("${probe.labels.pending}")` };
  }
  if (probe.kind === 'none') {
    const shot = await session.screenshot('connect-not-found');
    return {
      status: 'failed',
      detail:
        `no "Invite … to connect" for [${tokens.join(' ')}], neither in the top-card nor in the "More" menu` +
        (probe.labels.connected ? ' — looks like a 1st-degree connection already' : '') +
        `; aria-labels seen: ${JSON.stringify(probe.sample)}`,
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
      signal: { kind: 'weekly_limit', severity: 2, detail: 'weekly limit modal' },
      detail: 'weekly invite limit',
    };
  }
  const sig = await detectGuards(p);
  if (sig) return { status: 'blocked', signal: sig, detail: sig.detail };

  // --- invite modal: with a note only if asked for, otherwise WITHOUT ---
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

  // --- real verification: "Pending" must show up for this person ---
  const after = await S.probeTopCard(p, tokens, 15_000);
  if (after.kind === 'pending') {
    return {
      status: 'success',
      detail: `${opts.sendNote && opts.note ? 'invite sent with a note' : 'invite sent without a note'} — CONFIRMED ("${after.labels.pending}")`,
    };
  }

  // Not confirmed: we return 'failed' on purpose. On the retry the probe
  // re-reads the state: if the invite had gone through it finds "Pending"
  // and the request gets skipped, so nothing is ever sent twice.
  const shot = await session.screenshot('connect-unconfirmed');
  return {
    status: 'failed',
    detail: `clicked but no "Pending" detected for [${tokens.join(' ')}]; aria-labels seen: ${JSON.stringify(after.sample)}`,
    screenshot: shot,
  };
}

// ---------------- MESSAGE (requires 1st degree) ----------------
export async function sendMessage(session: LinkedInSession, contact: Contact, text: string): Promise<ActionResult> {
  const p = page(session);
  const tokens = S.tokensForContact(contact);
  if (tokens.length === 0) return unanchored(contact, 'Message');

  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;
  await H.readingPause();

  const probe = await S.probeTopCard(p, tokens, 15_000);
  if (!probe.labels.message) {
    const shot = await session.screenshot('message-btn-not-found');
    return {
      status: 'failed',
      detail: `no "Message" control found for [${tokens.join(' ')}] (not a 1st-degree connection?); aria-labels seen: ${JSON.stringify(probe.sample)}`,
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
    return { status: 'failed', detail: 'message editor not found', screenshot: shot };
  }
  await H.humanType(p, editor, text);
  await H.shortPause(700, 1700);

  const send = S.messageSendButton(p);
  if (await vis(send, 3000)) {
    await H.humanClick(send);
    await H.shortPause(800, 1800);
    const sig = await detectGuards(p);
    if (sig) return { status: 'blocked', signal: sig, detail: sig.detail };
    return { status: 'success', detail: 'message sent' };
  }
  const shot = await session.screenshot('message-send-disabled');
  return { status: 'failed', detail: 'message send button not available', screenshot: shot };
}

// ---------------- FOLLOW ----------------
export async function followProfile(session: LinkedInSession, contact: Contact): Promise<ActionResult> {
  const p = page(session);
  const tokens = S.tokensForContact(contact);
  if (tokens.length === 0) return unanchored(contact, 'Follow');

  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;
  await H.readingPause();

  let probe = await S.probeTopCard(p, tokens, 15_000);
  // "Follow" is often not in the top-card: it lives in the "More" menu.
  if (!probe.labels.follow && (await openMoreMenu(p))) {
    const inMenu = await S.probeTopCard(p, tokens, 10_000);
    if (inMenu.labels.follow) probe = inMenu;
  }
  if (!probe.labels.follow) {
    return {
      status: 'skipped',
      detail: `no "Follow" control found for [${tokens.join(' ')}]; aria-labels seen: ${JSON.stringify(probe.sample)}`,
    };
  }

  await H.humanClick(S.byExactLabel(p, probe.labels.follow));
  await H.shortPause(600, 1500);
  const strayed = strayedOffProfile(p);
  if (strayed) return strayed;
  return { status: 'success', detail: 'now following' };
}

// ---------------- LIKE most recent post (best-effort) ----------------
export async function likeRecentPost(session: LinkedInSession, contact: Contact): Promise<ActionResult> {
  const p = page(session);
  const actUrl = contact.profile_url.replace(/\/+$/, '') + '/recent-activity/all/';
  const blocked = await open(session, actUrl);
  if (blocked) return blocked;
  await H.humanScroll(p, randInt(1, 3));

  const likeBtn = S.likeControl(p);
  if (!(await vis(likeBtn, 2500))) return { status: 'skipped', detail: 'no recent post to like' };
  await H.humanClick(likeBtn);
  await H.shortPause(600, 1400);
  const strayed = strayedOffProfile(p);
  if (strayed) return strayed;
  return { status: 'success', detail: 'liked a recent post' };
}

// ---------------- ACCEPTANCE CHECK ----------------
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
  // No invite in flight and there is a "Message <Name>": it's a 1st degree.
  if (probe.labels.message) return { status: 'success', detail: 'accepted' };

  // Final say to the "More" menu: "Connect" (out of network) or
  // "Remove your connection" (accepted).
  if (await openMoreMenu(p)) {
    const inMenu = await S.probeTopCard(p, tokens, 10_000);
    if (inMenu.kind === 'pending') return { status: 'success', detail: 'pending' };
    if (inMenu.kind === 'connect') return { status: 'success', detail: 'not_connected' };
    if (inMenu.labels.connected || inMenu.labels.message) return { status: 'success', detail: 'accepted' };
    await p.keyboard.press('Escape').catch(() => {});
  }
  return { status: 'success', detail: 'unknown' };
}

// ---------------- WITHDRAW a pending invite ----------------
export async function withdrawInvite(session: LinkedInSession, contact: Contact): Promise<ActionResult> {
  const p = page(session);
  const tokens = S.tokensForContact(contact);
  if (tokens.length === 0) return unanchored(contact, 'Withdraw invite');

  const blocked = await open(session, contact.profile_url);
  if (blocked) return blocked;

  const probe = await S.probeTopCard(p, tokens, 15_000);
  if (probe.kind !== 'pending') return { status: 'skipped', detail: 'no pending invite' };

  await H.humanClick(S.byExactLabel(p, probe.labels.pending!));
  await H.shortPause(600, 1500);
  const strayed = strayedOffProfile(p);
  if (strayed) return strayed;

  const confirm = S.withdrawConfirmControl(p);
  if (!(await vis(confirm, 3000))) {
    const shot = await session.screenshot('withdraw-confirm-not-found');
    return { status: 'failed', detail: 'withdrawal confirmation not found', screenshot: shot };
  }
  await H.humanClick(confirm);
  await H.shortPause(1200, 2200);

  // Real verification: "Pending" must be gone.
  const after = await S.probeTopCard(p, tokens, 10_000);
  if (after.kind === 'pending') {
    const shot = await session.screenshot('withdraw-unconfirmed');
    return { status: 'failed', detail: 'withdrawal not confirmed: "Pending" still there', screenshot: shot };
  }
  return { status: 'success', detail: 'invite withdrawn' };
}
