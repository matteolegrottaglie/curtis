// ============================================================
//  Test dei selettori su DOM sintetico — nessuna rete, nessun
//  account: riproduce i findings verificati sulla UI LinkedIn del
//  2026-08-20 (probing dal vivo) e li blocca contro le regressioni.
//
//  Da rilanciare OGNI VOLTA che si tocca src/linkedin/selectors.ts:
//      npx tsx scripts/selectors-fixture-test.ts
//
//  Se la cache dei browser Playwright non combacia con la versione
//  del pacchetto, passare il binario a mano:
//      PW_BIN=/percorso/chrome-headless-shell npx tsx scripts/...
//
//  ATTENZIONE: un fixture che passa NON garantisce che la UI vera sia
//  ancora così. Qui si verifica la LOGICA di ancoraggio al nome e di
//  click; la UI vera va ri-sondata con scripts/connect-no-note.ts.
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
check('nome pieno', JSON.stringify(S.tokensForContact(mk({ full_name: 'Giulia Ferrari' }))) === '["giulia","ferrari"]');
check('accenti + titolo', JSON.stringify(S.tokensForContact(mk({ full_name: 'Dr. Chloé Marchesì' }))) === '["chloe","marchesi"]',
  S.tokensForContact(mk({ full_name: 'Dr. Chloé Marchesì' })));
check('first+last', JSON.stringify(S.tokensForContact(mk({ first_name: 'Anna', last_name: 'Bianchi' }))) === '["anna","bianchi"]');
check('fallback slug (scarta hash)',
  JSON.stringify(S.tokensForContact(mk({ profile_url: 'https://www.linkedin.com/in/giulia-ferrari-1a2b3c4/' }))) === '["giulia","ferrari"]',
  S.tokensForContact(mk({ profile_url: 'https://www.linkedin.com/in/giulia-ferrari-1a2b3c4/' })));
check('nessun ancoraggio → []', S.tokensForContact(mk({ profile_url: 'https://www.linkedin.com/in/ab/' })).length === 0);

// ---- il bug originale, riprodotto -------------------------------------
console.log('\n— regressione: getByRole vs aria-label —');
await page.setContent(TOPCARD('Giulia Ferrari'));
check('getByRole(button,/^connect$/) → 0 (il bug)',
  (await page.getByRole('button', { name: /^\s*connect\s*$/i }).count()) === 0);
check('[aria-label*="connect"] → trovato', (await page.locator('[aria-label*="connect" i]').count()) >= 2);

// ---- probe ancorato al nome -------------------------------------------
console.log('\n— probeTopCard —');
const target = S.tokensForContact(mk({ full_name: 'Giulia Ferrari' }));
const pr = await S.probeTopCard(page, target, 5000);
check("kind = 'connect'", pr.kind === 'connect', pr.kind);
check('label = quella della top-card, NON della sidebar', pr.label === 'Invite Giulia Ferrari to connect', pr.label);
check('nessun falso match sul follow/message', !pr.labels.message && !pr.labels.follow, pr.labels);

const other = await S.probeTopCard(page, ['mario', 'rossini'], 5000);
check('token diversi → si aggancia alla persona giusta (sidebar)', other.label === 'Invite Mario Rossini to connect', other.label);
const nobody = await S.probeTopCard(page, ['zzzz', 'qqqq'], 3000);
check("nessuna corrispondenza → kind 'none'", nobody.kind === 'none' && nobody.sample.length >= 2, nobody);
check('tokens vuoti → probe rifiuta subito', (await S.probeTopCard(page, [], 3000)).kind === 'none');

await page.setContent(PENDING);
const pend = await S.probeTopCard(page, target, 5000);
check("pending riconosciuto (e NON come 'connect')", pend.kind === 'pending', pend.kind);
check('label pending esatta', pend.labels.pending === 'Pending, click to withdraw invitation sent to Giulia Ferrari', pend.labels.pending);

await page.setContent(CONNECTED);
const conn = await S.probeTopCard(page, target, 5000);
check("1° grado: kind 'none' + label message", conn.kind === 'none' && conn.labels.message === 'Message Giulia Ferrari', conn);

// ---- menu "Altro": <div aria-label> dentro <a role=menuitem> ----------
console.log('\n— menu Altro —');
await page.setContent(MOREMENU);
const menu = await S.probeTopCard(page, target, 5000);
check('connect trovato dentro il menu', menu.kind === 'connect', menu.kind);
await page.evaluate(() => ((window as any).__hit = null));
await H.humanClick(S.byExactLabel(page, menu.label!));
check("click risalito all'<a role=menuitem>", (await page.evaluate(() => (window as any).__hit)) === 'MENUITEM',
  await page.evaluate(() => (window as any).__hit));

// ---- click sotto la top-nav sticky ------------------------------------
console.log('\n— click con top-nav sticky sovrapposta —');
await page.setContent(TOPCARD('Giulia Ferrari'));
await page.evaluate(() => {
  (window as any).__hit = null;
  // il Connect finisce esattamente sotto l'header fisso
  (document.querySelector('main') as HTMLElement).style.paddingTop = '40px';
});
await H.humanClick(S.byExactLabel(page, 'Invite Giulia Ferrari to connect'));
const hit = await page.evaluate(() => (window as any).__hit);
check('ha cliccato CONNECT, non il banner Premium', hit === 'CONNECT', hit);

// ---- controlli della modale invito: match sul VISIBILE ----------------
console.log('\n— modale invito —');
await page.setContent(`<style>${CSS}</style>
  <div class="msg-overlay" style="display:none"><button>Send</button></div>
  <div role="dialog">
    <button onclick="window.__hit='ADDNOTE'">Add a note</button>
    <button onclick="window.__hit='NONOTE'">Send without a note</button>
  </div>`);
await page.evaluate(() => ((window as any).__hit = null));
check('addNote trovato', await S.addNoteControl(page).isVisible());
await H.humanClick(S.sendWithoutNoteControl(page));
check('cliccato "Send without a note"', (await page.evaluate(() => (window as any).__hit)) === 'NONOTE',
  await page.evaluate(() => (window as any).__hit));

await page.setContent(`<style>${CSS}</style>
  <div style="display:none"><span>Send</span></div>
  <div role="dialog"><button onclick="window.__hit='SEND'">Send</button></div>`);
await page.evaluate(() => ((window as any).__hit = null));
await H.humanClick(S.sendInviteControl(page));
check('la "Send" NASCOSTA più in alto nel DOM non ruba il match',
  (await page.evaluate(() => (window as any).__hit)) === 'SEND', await page.evaluate(() => (window as any).__hit));

await browser.close();
console.log(failures === 0 ? '\n✓ tutti i controlli passati\n' : `\n✖ ${failures} controlli falliti\n`);
process.exit(failures === 0 ? 0 : 1);
