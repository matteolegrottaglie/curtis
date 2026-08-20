// ============================================================
//  Sends connection requests WITHOUT A NOTE, outside the engine.
//
//  Last step of the selector repair loop: after fixing
//  `src/linkedin/selectors.ts` and getting green on
//  `npm run test:selectors`, one isolated real send is needed to
//  tell whether the real UI behaves like the synthetic DOM.
//
//  Why the selectors look the way they do (applies here too):
//   - the top-card "Connect" is an <a> with aria-label
//     "Invite <Name> to connect", NOT a <button> and with no
//     role="button": `getByRole('button', ...)` returns zero;
//   - the name is NOT in an <h1>, so the target anchors on the
//     expected name tokens (from the CSV) and never touches the
//     "Connect" in the "More profiles for you" sidebar.
//
//  Does ONLY: profile visit + connection request without a note.
//  NB: no named function inside page.evaluate (esbuild/tsx would
//  inject the __name helper, which does not exist in page context).
// ============================================================
import { readFileSync } from 'node:fs';
import type { Page } from 'playwright';
import { LinkedInSession } from '../src/browser/session.js';
import { detectGuards } from '../src/linkedin/guards.js';
import * as H from '../src/browser/human.js';
import { DEFAULT_SAFETY_CONFIG } from '../src/config.js';
import { randInt } from '../src/util/rand.js';

interface Picked {
  full_name: string;
  profile_url: string;
}

function tokensOf(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

type Probe = { kind: 'connect' | 'pending' | 'none'; label?: string | null; sample?: string[] };

async function readTopCard(p: Page, tokens: string[], timeoutMs = 30_000): Promise<Probe> {
  const deadline = Date.now() + timeoutMs;
  let last: Probe = { kind: 'none', sample: [] };
  while (Date.now() < deadline) {
    last = (await p.evaluate((toks: string[]) => {
      const els = Array.from(document.querySelectorAll('[aria-label]')).filter(
        (e) => !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight),
      );
      const pending = els.find((e) => {
        const a = (e.getAttribute('aria-label') || '')
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase();
        return /pending|in attesa/.test(a) && toks.every((t) => a.includes(t));
      });
      if (pending) return { kind: 'pending', label: pending.getAttribute('aria-label') };

      const connect = els.find((e) => {
        const a = (e.getAttribute('aria-label') || '')
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase();
        return (/invite .* to connect/.test(a) || /invita .* a collegarsi/.test(a)) && toks.every((t) => a.includes(t));
      });
      if (connect) return { kind: 'connect', label: connect.getAttribute('aria-label') };

      return {
        kind: 'none',
        sample: els
          .map((e) => e.getAttribute('aria-label') || '')
          .filter((a) => /connect|collegarsi|pending|in attesa/i.test(a))
          .slice(0, 8),
      };
    }, tokens)) as Probe;
    if (last.kind !== 'none') return last;
    await p.waitForTimeout(1000);
  }
  return last;
}

function byLabel(p: Page, label: string) {
  return p.locator(`[aria-label="${label.replace(/"/g, '\\"')}"]`).first();
}

/**
 * Robust click: LinkedIn's sticky top-nav ("Claim Premium Page")
 * intercepts pointer events when the element sits under the header.
 * So the element is centered in the viewport before clicking, with
 * a force-click fallback.
 */
async function safeClick(loc: ReturnType<Page['locator']>): Promise<void> {
  await loc.evaluate((el) => (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' })).catch(() => {});
  await H.shortPause(400, 1100);
  await loc.hover().catch(() => {});
  await H.shortPause(200, 700);
  try {
    await loc.click({ timeout: 8_000 });
  } catch {
    // NEVER force:true — it would click at the COORDINATES and, if the
    // sticky top-nav overlaps, it hits the "Claim Premium Page" banner
    // and lands on the Premium checkout page (already happened).
    // Here the click is dispatched on the RIGHT ELEMENT.
    // The target may be a <div> inside an <a role="menuitem">:
    // click the interactive ancestor, otherwise the element itself.
    await loc.evaluate((el) => {
      const t = (el as HTMLElement).closest('a,button,[role="menuitem"]') || el;
      (t as HTMLElement).click();
    });
  }
}

/**
 * Some profiles (e.g. 3rd degree) do NOT expose "Connect" in the top-card:
 * the option only lives inside the "More" menu. This opens it.
 */
async function openMoreMenu(p: Page): Promise<boolean> {
  const more = p.locator('[aria-label="More"]').first();
  if (!(await more.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  await more.evaluate((el) => (el as HTMLElement).scrollIntoView({ block: 'center' })).catch(() => {});
  await H.shortPause(400, 1000);
  await more.evaluate((el) => (el as HTMLElement).click());
  await H.shortPause(1200, 2200);
  return true;
}

async function processOne(session: LinkedInSession, c: Picked): Promise<{ status: string; detail: string }> {
  const p = session.page!;
  const tokens = tokensOf(c.full_name);

  await p.goto(c.profile_url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await H.shortPause(1500, 3000);

  const sig = await detectGuards(p);
  if (sig) return { status: 'blocked', detail: `${sig.kind}: ${sig.detail ?? ''}` };
  if (/\/checkpoint\//i.test(p.url())) return { status: 'blocked', detail: `checkpoint: ${p.url()}` };

  await H.humanScroll(p, randInt(1, 2));
  let st = await readTopCard(p, tokens);

  // fallback: "Connect" may live only in the "More" menu
  if (st.kind === 'none') {
    if (await openMoreMenu(p)) {
      const st2 = await readTopCard(p, tokens, 10_000);
      if (st2.kind !== 'none') st = st2;
    }
  }

  if (st.kind === 'pending') return { status: 'skipped', detail: `invite ALREADY PENDING ("${st.label}") — no action` };
  if (st.kind === 'none') {
    const shot = await session.screenshot('v4-no-connect');
    return {
      status: 'failed',
      detail: `no "Invite ... to connect" for [${tokens.join(' ')}] in the top-card nor in the More menu; aria-labels seen: ${JSON.stringify(st.sample ?? [])} — ${shot ?? ''}`,
    };
  }

  await H.readingPause();
  await safeClick(byLabel(p, st.label!));
  await H.shortPause(1500, 2800);

  const sig2 = await detectGuards(p);
  if (sig2) return { status: 'blocked', detail: `${sig2.kind}: ${sig2.detail ?? ''}` };

  // SAFETY: if the click navigated away from the profile (e.g. Premium
  // upsell / checkout), stop right away and touch nothing.
  if (/\/premium\/|\/checkout|\/payment|upsell/i.test(p.url())) {
    return { status: 'aborted', detail: `ended up on a Premium/checkout page (${p.url()}) — no action, stopping` };
  }

  // --- invite modal: ALWAYS "without a note", never a note ---
  const noNote = p.getByText(/^\s*(send without a note|invia senza nota)\s*$/i).first();
  const sendBtn = p.getByText(/^\s*(send|invia)\s*$/i).first();
  if (await noNote.isVisible({ timeout: 6000 }).catch(() => false)) {
    await safeClick(noNote);
  } else if (await sendBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await safeClick(sendBtn);
  }
  await H.shortPause(1500, 3000);

  const sig3 = await detectGuards(p);
  if (sig3) return { status: 'blocked', detail: `${sig3.kind}: ${sig3.detail ?? ''}` };

  // --- real check: "Pending" must show up for this person ---
  const after = await readTopCard(p, tokens, 15_000);
  if (after.kind === 'pending') return { status: 'success', detail: `invite sent without a note — CONFIRMED ("${after.label}")` };

  const shot = await session.screenshot('v4-unconfirmed');
  return {
    status: 'unconfirmed',
    detail: `clicked but "Pending" not detected; aria-labels seen: ${JSON.stringify(after.sample ?? [])} — ${shot ?? ''}`,
  };
}

async function main(): Promise<void> {
  const picked: Picked[] = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
  const only = new Set((process.argv[3] ?? '').split(',').filter(Boolean));
  const targets = picked.filter((_, i) => only.size === 0 || only.has(String(i)));

  const session = new LinkedInSession();
  await session.launch();
  if (!(await session.isLoggedIn())) {
    console.error('✖ not logged in — no action');
    await session.close();
    process.exit(2);
  }
  console.log('✓ LinkedIn session active\n');

  const out: Array<{ name: string; status: string; detail: string }> = [];
  for (let i = 0; i < targets.length; i++) {
    const c = targets[i]!;
    console.log(`[${i + 1}/${targets.length}] ${c.full_name}`);
    const r = await processOne(session, c);
    console.log(`      ${r.status} — ${r.detail}`);
    out.push({ name: c.full_name, ...r });
    if (r.status === 'blocked' || r.status === 'aborted') {
      console.error('⛔ LinkedIn signal — stopping, no further invites.');
      break;
    }
    if (i < targets.length - 1) {
      const t = Date.now();
      await H.humanPause(DEFAULT_SAFETY_CONFIG);
      console.log(`      … pause ${Math.round((Date.now() - t) / 1000)}s\n`);
    }
  }

  console.log('\n───────── SUMMARY ─────────');
  for (const r of out) console.log(`${r.status.toUpperCase().padEnd(12)} ${r.name} — ${r.detail}`);
  console.log('───────────────────────────\n');
  await session.close();
}

main().catch((e) => {
  console.error('error:', e);
  process.exit(1);
});
