// ============================================================
//  Selector tests on a synthetic DOM — no network, no account:
//  reproduces the findings verified on the LinkedIn UI of
//  2026-08-20 (live probing) and locks them against regressions.
//
//  Re-run EVERY TIME src/linkedin/selectors.ts is touched:
//      npx tsx scripts/selectors-fixture-test.ts
//
//  If the Playwright browser cache does not match the package
//  version, pass the binary by hand:
//      PW_BIN=/path/to/chrome-headless-shell npx tsx scripts/...
//
//  WARNING: a passing fixture does NOT guarantee the real UI still
//  looks like this. Here we verify the LOGIC of name anchoring and
//  clicking; the real UI must be re-probed with scripts/connect-no-note.ts.
// ============================================================
import { chromium } from 'playwright';
import * as S from '../src/linkedin/selectors.js';
import * as H from '../src/browser/human.js';
import type { Contact } from '../src/types.js';

const CSS = `body{margin:0;font:14px sans-serif} header{position:fixed;top:0;left:0;right:0;height:120px;
background:#c00;color:#fff;z-index:9999;display:flex;align-items:center} main{padding-top:20px} a{display:block}`;

const TOPCARD = (name: string) => `
<style>${CSS}</style>
<header id="premium" onclick="window.__hit='PREMIUM'">Claim Premium Page for €0</header>
<main>
  <section class="top-card">
    <div class="name">${name}</div>
    <span>· 2nd</span>
    <a id="connect" aria-label="Invite ${name} to connect" href="#x"
       componentkey="ConnectButton" onclick="window.__hit='CONNECT';event.preventDefault()">Connect</a>
    <button aria-label="More">More</button>
  </section>
</main>
<aside>
  <h2>More profiles for you</h2>
  <a id="sidebar" aria-label="Invite Mario Rossini to connect" onclick="window.__hit='SIDEBAR'">Connect</a>
</aside>`;

const PENDING = `<style>${CSS}</style><main><section>
  <div>Giulia Ferrari</div>
  <a aria-label="Pending, click to withdraw invitation sent to Giulia Ferrari">Pending</a>
</section></main>`;

const MOREMENU = `<style>${CSS}</style><main><section>
  <div>Giulia Ferrari</div>
  <button aria-label="More">More</button>
  <div role="menu">
    <a role="menuitem" href="#y" onclick="window.__hit='MENUITEM';event.preventDefault()">
      <div aria-label="Invite Giulia Ferrari to connect">Connect</div>
    </a>
  </div>
</section></main>`;

const CONNECTED = `<style>${CSS}</style><main><section>
  <div>Giulia Ferrari</div>
  <span>· 1st</span>
  <a aria-label="Message Giulia Ferrari">Message</a>
  <button aria-label="More">More</button>
</section></main>`;

let failures = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ headless: true, ...(process.env.PW_BIN ? { executablePath: process.env.PW_BIN } : {}) });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });

// ---- tokensForContact -------------------------------------------------
const mk = (o: Partial<Contact>): Contact => ({
  id: '1', profile_url: 'https://www.linkedin.com/in/x/', public_id: null, first_name: null,
  last_name: null, full_name: null, headline: null, company: null, location: null,
  email: null, custom: null, source: null, created_at: 0, ...o,
});
console.log('\n— tokensForContact —');
check('full name', JSON.stringify(S.tokensForContact(mk({ full_name: 'Giulia Ferrari' }))) === '["giulia","ferrari"]');
check('accents + title', JSON.stringify(S.tokensForContact(mk({ full_name: 'Dr. Chloé Marchesì' }))) === '["chloe","marchesi"]',
  S.tokensForContact(mk({ full_name: 'Dr. Chloé Marchesì' })));
check('first+last', JSON.stringify(S.tokensForContact(mk({ first_name: 'Anna', last_name: 'Bianchi' }))) === '["anna","bianchi"]');
check('slug fallback (drops the hash)',
  JSON.stringify(S.tokensForContact(mk({ profile_url: 'https://www.linkedin.com/in/giulia-ferrari-1a2b3c4/' }))) === '["giulia","ferrari"]',
  S.tokensForContact(mk({ profile_url: 'https://www.linkedin.com/in/giulia-ferrari-1a2b3c4/' })));
check('no anchor → []', S.tokensForContact(mk({ profile_url: 'https://www.linkedin.com/in/ab/' })).length === 0);

// ---- the original bug, reproduced -------------------------------------
console.log('\n— regression: getByRole vs aria-label —');
await page.setContent(TOPCARD('Giulia Ferrari'));
check('getByRole(button,/^connect$/) → 0 (the bug)',
  (await page.getByRole('button', { name: /^\s*connect\s*$/i }).count()) === 0);
check('[aria-label*="connect"] → found', (await page.locator('[aria-label*="connect" i]').count()) >= 2);

// ---- name-anchored probe ----------------------------------------------
console.log('\n— probeTopCard —');
const target = S.tokensForContact(mk({ full_name: 'Giulia Ferrari' }));
const pr = await S.probeTopCard(page, target, 5000);
check("kind = 'connect'", pr.kind === 'connect', pr.kind);
check('label = the top-card one, NOT the sidebar one', pr.label === 'Invite Giulia Ferrari to connect', pr.label);
check('no false match on follow/message', !pr.labels.message && !pr.labels.follow, pr.labels);

const other = await S.probeTopCard(page, ['mario', 'rossini'], 5000);
check('different tokens → latches onto the right person (sidebar)', other.label === 'Invite Mario Rossini to connect', other.label);
const nobody = await S.probeTopCard(page, ['zzzz', 'qqqq'], 3000);
check("no match → kind 'none'", nobody.kind === 'none' && nobody.sample.length >= 2, nobody);
check('empty tokens → probe bails out immediately', (await S.probeTopCard(page, [], 3000)).kind === 'none');

await page.setContent(PENDING);
const pend = await S.probeTopCard(page, target, 5000);
check("pending recognized (and NOT as 'connect')", pend.kind === 'pending', pend.kind);
check('exact pending label', pend.labels.pending === 'Pending, click to withdraw invitation sent to Giulia Ferrari', pend.labels.pending);

await page.setContent(CONNECTED);
const conn = await S.probeTopCard(page, target, 5000);
check("1st degree: kind 'none' + message label", conn.kind === 'none' && conn.labels.message === 'Message Giulia Ferrari', conn);

// ---- "More" menu: <div aria-label> inside <a role=menuitem> -----------
console.log('\n— More menu —');
await page.setContent(MOREMENU);
const menu = await S.probeTopCard(page, target, 5000);
check('connect found inside the menu', menu.kind === 'connect', menu.kind);
await page.evaluate(() => ((window as any).__hit = null));
await H.humanClick(S.byExactLabel(page, menu.label!));
check('click bubbled up to the <a role=menuitem>', (await page.evaluate(() => (window as any).__hit)) === 'MENUITEM',
  await page.evaluate(() => (window as any).__hit));

// ---- click underneath the sticky top-nav ------------------------------
console.log('\n— click with the sticky top-nav overlapping —');
await page.setContent(TOPCARD('Giulia Ferrari'));
await page.evaluate(() => {
  (window as any).__hit = null;
  // the Connect ends up exactly under the fixed header
  (document.querySelector('main') as HTMLElement).style.paddingTop = '40px';
});
await H.humanClick(S.byExactLabel(page, 'Invite Giulia Ferrari to connect'));
const hit = await page.evaluate(() => (window as any).__hit);
check('clicked CONNECT, not the Premium banner', hit === 'CONNECT', hit);

// ---- invite modal controls: match on what is VISIBLE ------------------
console.log('\n— invite modal —');
await page.setContent(`<style>${CSS}</style>
  <div class="msg-overlay" style="display:none"><button>Send</button></div>
  <div role="dialog">
    <button onclick="window.__hit='ADDNOTE'">Add a note</button>
    <button onclick="window.__hit='NONOTE'">Send without a note</button>
  </div>`);
await page.evaluate(() => ((window as any).__hit = null));
check('addNote found', await S.addNoteControl(page).isVisible());
await H.humanClick(S.sendWithoutNoteControl(page));
check('clicked "Send without a note"', (await page.evaluate(() => (window as any).__hit)) === 'NONOTE',
  await page.evaluate(() => (window as any).__hit));

await page.setContent(`<style>${CSS}</style>
  <div style="display:none"><span>Send</span></div>
  <div role="dialog"><button onclick="window.__hit='SEND'">Send</button></div>`);
await page.evaluate(() => ((window as any).__hit = null));
await H.humanClick(S.sendInviteControl(page));
check('the HIDDEN "Send" earlier in the DOM does not steal the match',
  (await page.evaluate(() => (window as any).__hit)) === 'SEND', await page.evaluate(() => (window as any).__hit));

await browser.close();
console.log(failures === 0 ? '\n✓ all checks passed\n' : `\n✖ ${failures} checks failed\n`);
process.exit(failures === 0 ? 0 : 1);
