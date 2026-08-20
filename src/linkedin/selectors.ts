// ============================================================
//  LinkedIn selectors — CENTRALIZED because they are FRAGILE.
//
//  REWRITTEN on 2026-08-20 after probing the live DOM.
//  Reference implementation: scripts/connect-no-note.ts.
//
//  WHAT WAS BROKEN — everything went through getByRole('button', { name }).
//  In the current UI the top-card controls are NOT <button>s:
//  "Connect" is an <a> with aria-label "Invite <Name> to connect" and
//  no role="button", so getByRole('button') returned 0 results.
//  On top of that the accessible name isn't "Connect" but "Invite
//  <Name> to connect": the old anchored /^connect$/ never matched.
//
//  RULES FOR THIS FILE
//   1. Select by aria-label, not by role.
//   2. The aria-label must ALWAYS be anchored to the name tokens of
//      the target person: the "More profiles for you" sidebar has
//      its own "Connect" controls and they must NEVER be clicked.
//   3. Regexes are always IT + EN: the account renders the UI in
//      English even with locale it-IT set in session.ts (verified).
//   4. The name is NOT inside an <h1>: never anchor to 'main h1'.
//   5. Inside page.evaluate NO named functions (neither declared nor
//      assigned to a const): tsx/esbuild with keepNames injects the
//      __name helper, which does not exist in the page context
//      (ReferenceError). Only anonymous arrows passed as arguments.
//   6. RegExps do not cross the Node↔page boundary: pass `.source`
//      and rebuild them with new RegExp() inside evaluate.
// ============================================================
import type { Page, Locator } from 'playwright';
import type { Contact } from '../types.js';

export const RX = {
  // --- top-card aria-labels --------------------------------------
  // Matched against the NORMALIZED aria-label (NFD without accents,
  // lowercased): write them lowercase and without the /i flag.
  connectLabel: /invite .* to connect|invita .* a collegarsi/,
  pendingLabel: /(^|\W)(pending|in attesa)(\W|$)/,
  messageLabel: /^(message|messaggia|invia un messaggio a)\b/,
  followLabel: /^(follow|segui)\b/,
  /** Only inside the "More"/"Altro" menu of a 1st-degree connection. */
  connectedLabel: /remove (your )?connection|rimuovi (il )?collegamento/,
  /** For diagnostics: which aria-labels are worth reporting. */
  interestingLabel: /connect|collegarsi|pending|in attesa|message|messaggia|follow|segui/,

  // --- invite modal control texts ---------------------------------
  // These aren't <button>s either: they're picked by exact TEXT.
  sendWithoutNote: /^\s*(send without a note|invia senza nota|invia ora|send now)\s*$/i,
  addNote: /^\s*(add a note|aggiungi una nota|aggiungi nota)\s*$/i,
  send: /^\s*(send|invia)\s*$/i,
  withdraw: /^\s*(withdraw|ritira|annulla invito|ritira invito)\s*$/i,
  like: /^\s*(like|consiglia|mi piace)\s*$/i,

  /** URLs to run away from at once: the click went off the rails. */
  offProfileUrl: /\/premium\/|\/checkout|\/payment|upsell/i,
} as const;

// ============================================================
//  Name anchoring
// ============================================================

/** Meaningful tokens of a name: lowercase, no accents, no punctuation. */
export function tokensOf(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * Tokens to anchor the selectors to THIS person.
 * Falls back to the URL slug (/in/first-last-1a2b3c/) discarding
 * the chunks that contain digits (LinkedIn's trailing hash).
 *
 * If this returns [] then NOTHING may be clicked: with no name anchor
 * the risk is hitting the "Connect" of a profile in the sidebar.
 */
export function tokensForContact(contact: Contact): string[] {
  const named = contact.full_name ?? [contact.first_name, contact.last_name].filter(Boolean).join(' ');
  const fromName = named ? tokensOf(named) : [];
  if (fromName.length > 0) return fromName;

  const slug = /\/in\/([^/?#]+)/i.exec(contact.profile_url)?.[1] ?? contact.public_id ?? '';
  return tokensOf(decodeURIComponent(slug).replace(/-/g, ' ')).filter((t) => !/\d/.test(t));
}

// ============================================================
//  Top-card probe
// ============================================================

export type InviteState = 'connect' | 'pending' | 'none';

export interface TopCardProbe {
  /** Invite state for THIS person. */
  kind: InviteState;
  /** Exact aria-label of the connect/pending control (to pass to byExactLabel). */
  label: string | null;
  /** Exact aria-labels of every name-anchored control found. */
  labels: {
    connect?: string;
    pending?: string;
    message?: string;
    follow?: string;
    connected?: string;
  };
  /** "Interesting" aria-labels seen on the page — diagnostics only. */
  sample: string[];
}

const EMPTY_PROBE: TopCardProbe = { kind: 'none', label: null, labels: {}, sample: [] };

/**
 * Looks for the top-card controls, anchoring them to the name tokens.
 *
 * Polls until it finds something anchored to the name (the top-card
 * is hydrated late) or until the timeout expires. ONE name-anchored
 * control is enough — even just "Message" — to call the top-card
 * rendered and bail out right away: without this, profiles that are
 * already 1st-degree would sit out the whole timeout.
 */
export async function probeTopCard(page: Page, tokens: string[], timeoutMs = 15_000): Promise<TopCardProbe> {
  if (tokens.length === 0) return EMPTY_PROBE; // with no anchor we don't even look

  const patterns = {
    connect: RX.connectLabel.source,
    pending: RX.pendingLabel.source,
    message: RX.messageLabel.source,
    follow: RX.followLabel.source,
    connected: RX.connectedLabel.source,
    interesting: RX.interestingLabel.source,
  };

  const deadline = Date.now() + timeoutMs;
  let last: TopCardProbe = EMPTY_PROBE;

  while (Date.now() < deadline) {
    const seen = await page
      .evaluate(
        (arg: { toks: string[]; rx: typeof patterns }) => {
          // RegExps don't survive the Node->page boundary: here they
          // are rebuilt from the `.source` strings passed in.
          const rxConnect = new RegExp(arg.rx.connect);
          const rxPending = new RegExp(arg.rx.pending);
          const rxMessage = new RegExp(arg.rx.message);
          const rxFollow = new RegExp(arg.rx.follow);
          const rxConnected = new RegExp(arg.rx.connected);
          const rxInteresting = new RegExp(arg.rx.interesting);

          const items = Array.from(document.querySelectorAll('[aria-label]'))
            .filter((e) => !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight))
            .map((e) => ({
              raw: e.getAttribute('aria-label') || '',
              norm: (e.getAttribute('aria-label') || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase(),
              // the top-card lives in <main>; "More profiles for you" in <aside>
              inMain: !!e.closest('main') && !e.closest('aside'),
            }));

          // Top-card controls first, everything else after: if two
          // people share the name tokens, the profile's own wins.
          const ranked = items.filter((i) => i.inMain).concat(items.filter((i) => !i.inMain));
          const mine = ranked.filter((i) => arg.toks.every((t) => i.norm.includes(t)));

          // pending BEFORE connect: "Pending, click to withdraw
          // invitation sent to <Name>" contains "invitation" too.
          const pending = mine.find((i) => rxPending.test(i.norm));
          const connect = mine.find((i) => rxConnect.test(i.norm));
          const message = mine.find((i) => rxMessage.test(i.norm));
          const follow = mine.find((i) => rxFollow.test(i.norm));
          const connected = mine.find((i) => rxConnected.test(i.norm));

          return {
            connect: connect?.raw,
            pending: pending?.raw,
            message: message?.raw,
            follow: follow?.raw,
            connected: connected?.raw,
            // `sample` is page-controlled text that ends up in tool output and
            // therefore in a model's context. Collapse whitespace, drop control
            // AND Unicode format characters, then cap the length, so a hostile
            // profile cannot smuggle a multi-line instruction block through an
            // aria-label. \p{Cf} matters as much as the C0/C1 range: it covers
            // the bidi overrides U+202A-U+202E and the invisible tag block
            // U+E0000-U+E007F, which a model reads but a human auditing the log
            // never sees.
            // NOTE: the `labels.*` above stay byte-exact — byExactLabel() clicks
            // with them. Sanitising a label for the LOG is the caller's job, via
            // sanitizeForLog(); a sanitised label must never be used as a selector.
            sample: items
              .filter((i) => rxInteresting.test(i.norm))
              .slice(0, 10)
              .map((i) =>
                i.raw
                  .replace(/[\u0000-\u001f\u007f-\u009f]|\p{Cf}/gu, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 120),
              ),
          };
        },
        { toks: tokens, rx: patterns },
      )
      .catch(() => null); // navigation in flight: retry on the next pass

    if (seen) {
      const labels = {
        ...(seen.connect ? { connect: seen.connect } : {}),
        ...(seen.pending ? { pending: seen.pending } : {}),
        ...(seen.message ? { message: seen.message } : {}),
        ...(seen.follow ? { follow: seen.follow } : {}),
        ...(seen.connected ? { connected: seen.connected } : {}),
      };
      last = {
        kind: seen.pending ? 'pending' : seen.connect ? 'connect' : 'none',
        label: seen.pending ?? seen.connect ?? null,
        labels,
        sample: seen.sample,
      };
      if (Object.keys(labels).length > 0) return last;
    }
    await page.waitForTimeout(1000);
  }
  return last;
}

/**
 * Sanitises a raw aria-label for a LOG line.
 *
 * `labels.*` come off the page byte-exact because byExactLabel() clicks with
 * them — but they also get interpolated into the `detail` of an action, which
 * `get_recent_actions` hands to a model. That is the same prompt-injection path
 * `sample` is sanitised against, so anything page-controlled must go through
 * here before it is written into a detail string.
 *
 * NEVER feed the result back to byExactLabel(): it is lossy on purpose.
 */
export function sanitizeForLog(label: string | undefined | null, max = 120): string {
  if (!label) return '';
  return label
    .replace(/[\u0000-\u001f\u007f-\u009f]|\p{Cf}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Locator by EXACT aria-label — the only safe way to re-grab what the probe found.
 *
 * A CSS string cannot hold a raw newline/CR/FF: with one in the label the
 * selector is a BADSTRING and Playwright throws instead of just not matching,
 * which turns a weird profile name into a hard failure of connect / message /
 * follow / withdraw. They are emitted as CSS escapes (`\A ` etc.), which denote
 * the very same characters, so the match stays exact.
 */
export function byExactLabel(page: Page, label: string): Locator {
  const css = label
    .replace(/["\\]/g, '\\$&')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '\\D ')
    .replace(/\f/g, '\\C ');
  return page.locator(`[aria-label="${css}"]`).first();
}

// ============================================================
//  Controls that can't be anchored to the name
// ============================================================

/**
 * Top-card "More" menu. EXACT aria-label "More" (or "Altro"):
 * some profiles (3rd-degree, say) don't expose "Connect" in the
 * top-card at all and keep it only in here, as an <a role="menuitem">
 * wrapping a <div aria-label="Invite <Name> to connect">.
 */
export function moreButton(page: Page): Locator {
  return page.locator('[aria-label="More"], [aria-label="Altro"]').first();
}

// --- invite modal (controls picked by TEXT, they aren't <button>s) ---
//
// Deliberately NOT scoped to [role="dialog"]: it is unverified that
// the invite modal exposes that role, and getting the scope wrong
// would mean never sending anything again. The `visible` filter is
// there so the match isn't stolen by a HIDDEN namesake higher up in
// the DOM (e.g. the "Send" of the closed messaging overlay):
// getByText matches invisible elements too.
// The real safety net: after the click we re-check the "Pending".
const byVisibleText = (page: Page, rx: RegExp): Locator => page.getByText(rx).filter({ visible: true }).first();

export function sendWithoutNoteControl(page: Page): Locator {
  return byVisibleText(page, RX.sendWithoutNote);
}
export function addNoteControl(page: Page): Locator {
  return byVisibleText(page, RX.addNote);
}
export function noteTextarea(page: Page): Locator {
  return page.locator('textarea[name="message"], #custom-message').first();
}
export function sendInviteControl(page: Page): Locator {
  return byVisibleText(page, RX.send);
}

// --- invite withdrawal confirmation ---
export function withdrawConfirmControl(page: Page): Locator {
  return byVisibleText(page, RX.withdraw);
}

// --- messaging (msg-form overlay: here the <button>s still exist) ---
export function messageEditor(page: Page): Locator {
  return page
    .locator('.msg-form__contenteditable[contenteditable="true"], .msg-form [contenteditable="true"], [role="textbox"][contenteditable="true"]')
    .first();
}
export function messageSendButton(page: Page): Locator {
  return page
    .locator('.msg-form__send-button, button[type="submit"].msg-form__send-button')
    .filter({ visible: true })
    .first()
    .or(page.locator('.msg-form').getByText(RX.send).filter({ visible: true }).first());
}

// --- like on a recent post (best-effort) ---
export function likeControl(page: Page): Locator {
  // aria-label "Like <Name>'s post" / "React Like" / "Consiglia ...".
  // ^Like doesn't match "Unlike": an already-liked post is skipped.
  return page
    .locator(
      '[aria-label^="React Like" i], [aria-label^="Like" i], [aria-label^="Consiglia" i], [aria-label^="Mi piace" i]',
    )
    .filter({ visible: true })
    .first();
}
