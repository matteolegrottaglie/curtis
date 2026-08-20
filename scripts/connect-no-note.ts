// ============================================================
//  Invio richieste di collegamento SENZA NOTA — v4.
//
//  CAUSA RADICE (confermata da diag-deep):
//  il controllo "Connect" della top-card è un <a> con
//  aria-label "Invite <Nome> to connect" — NON un <button>, e senza
//  role="button". Perciò getByRole('button', ...) -> 0 risultati, e
//  tutto src/linkedin/selectors.ts è rotto contro la UI attuale.
//
//  v3 falliva ancora perché richiedeva un <h1> per leggere il nome:
//  nella UI attuale il nome NON è in un <h1>. Qui il target si ancora
//  ai token del nome attesi (dal CSV), così non si tocca mai il
//  "Connect" della sidebar "More profiles for you".
//
//  Fa SOLO: visita profilo + richiesta di collegamento senza nota.
//  NB: nessuna funzione con nome dentro page.evaluate (esbuild/tsx
//  inietterebbe l'helper __name, inesistente nel contesto pagina).
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
 * Click robusto: la top-nav sticky di LinkedIn ("Claim Premium Page")
 * intercetta i pointer event se l'elemento resta sotto l'header.
 * Quindi si centra l'elemento nel viewport prima di cliccare, con
 * fallback su force click.
 */
async function safeClick(loc: ReturnType<Page['locator']>): Promise<void> {
  await loc.evaluate((el) => (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' })).catch(() => {});
  await H.shortPause(400, 1100);
  await loc.hover().catch(() => {});
  await H.shortPause(200, 700);
  try {
    await loc.click({ timeout: 8_000 });
  } catch {
    // MAI force:true — cliccherebbe alle COORDINATE e, se la top-nav
    // sticky è sovrapposta, colpisce il banner "Claim Premium Page"
    // portando alla pagina di checkout Premium (già successo).
    // Qui il click viene dispatchato sull'ELEMENTO giusto.
    // Il target può essere un <div> dentro un <a role="menuitem">:
    // si clicca l'antenato interattivo, altrimenti l'elemento stesso.
    await loc.evaluate((el) => {
      const t = (el as HTMLElement).closest('a,button,[role="menuitem"]') || el;
      (t as HTMLElement).click();
    });
  }
}

/**
 * Alcuni profili (es. 3° grado) NON espongono "Connect" nella top-card:
 * l'opzione esiste solo dentro il menu "More". Qui lo si apre.
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

  // fallback: "Connect" può stare solo nel menu "More"
  if (st.kind === 'none') {
    if (await openMoreMenu(p)) {
      const st2 = await readTopCard(p, tokens, 10_000);
      if (st2.kind !== 'none') st = st2;
    }
  }

  if (st.kind === 'pending') return { status: 'skipped', detail: `invito GIÀ PENDENTE ("${st.label}") — nessuna azione` };
  if (st.kind === 'none') {
    const shot = await session.screenshot('v4-no-connect');
    return {
      status: 'failed',
      detail: `nessun "Invite ... to connect" per [${tokens.join(' ')}] né in top-card né nel menu More; aria-label viste: ${JSON.stringify(st.sample ?? [])} — ${shot ?? ''}`,
    };
  }

  await H.readingPause();
  await safeClick(byLabel(p, st.label!));
  await H.shortPause(1500, 2800);

  const sig2 = await detectGuards(p);
  if (sig2) return { status: 'blocked', detail: `${sig2.kind}: ${sig2.detail ?? ''}` };

  // SICUREZZA: se il click ha portato fuori dal profilo (es. upsell
  // Premium / checkout), fermarsi subito e non toccare nulla.
  if (/\/premium\/|\/checkout|\/payment|upsell/i.test(p.url())) {
    return { status: 'aborted', detail: `finito su pagina Premium/checkout (${p.url()}) — nessuna azione, mi fermo` };
  }

  // --- modale invito: SEMPRE "senza nota", mai una nota ---
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

  // --- verifica reale: deve comparire "Pending" per questa persona ---
  const after = await readTopCard(p, tokens, 15_000);
  if (after.kind === 'pending') return { status: 'success', detail: `invito inviato senza nota — CONFERMATO ("${after.label}")` };

  const shot = await session.screenshot('v4-unconfirmed');
  return {
    status: 'unconfirmed',
    detail: `cliccato ma "Pending" non rilevato; aria-label viste: ${JSON.stringify(after.sample ?? [])} — ${shot ?? ''}`,
  };
}

async function main(): Promise<void> {
  const picked: Picked[] = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
  const only = new Set((process.argv[3] ?? '').split(',').filter(Boolean));
  const targets = picked.filter((_, i) => only.size === 0 || only.has(String(i)));

  const session = new LinkedInSession();
  await session.launch();
  if (!(await session.isLoggedIn())) {
    console.error('✖ non loggato — nessuna azione');
    await session.close();
    process.exit(2);
  }
  console.log('✓ sessione LinkedIn attiva\n');

  const out: Array<{ name: string; status: string; detail: string }> = [];
  for (let i = 0; i < targets.length; i++) {
    const c = targets[i]!;
    console.log(`[${i + 1}/${targets.length}] ${c.full_name}`);
    const r = await processOne(session, c);
    console.log(`      ${r.status} — ${r.detail}`);
    out.push({ name: c.full_name, ...r });
    if (r.status === 'blocked' || r.status === 'aborted') {
      console.error('⛔ segnale LinkedIn — mi fermo, nessun altro invito.');
      break;
    }
    if (i < targets.length - 1) {
      const t = Date.now();
      await H.humanPause(DEFAULT_SAFETY_CONFIG);
      console.log(`      … pausa ${Math.round((Date.now() - t) / 1000)}s\n`);
    }
  }

  console.log('\n──────── RIEPILOGO ────────');
  for (const r of out) console.log(`${r.status.toUpperCase().padEnd(12)} ${r.name} — ${r.detail}`);
  console.log('───────────────────────────\n');
  await session.close();
}

main().catch((e) => {
  console.error('errore:', e);
  process.exit(1);
});
