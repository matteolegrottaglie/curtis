// ============================================================
//  SOLA LETTURA. Apre i profili e legge lo stato dell'invito con
//  il probe nuovo. NON clicca niente, non invia niente.
//  Serve a sapere CHI ha davvero ancora il "Connect" prima di agire.
// ============================================================
import { readFileSync } from 'node:fs';
import { LinkedInSession } from '../src/browser/session.js';
import { detectGuards } from '../src/linkedin/guards.js';
import * as S from '../src/linkedin/selectors.js';
import * as H from '../src/browser/human.js';
import { randInt } from '../src/util/rand.js';

const targets = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Array<{
  full_name: string;
  profile_url: string;
}>;

const session = new LinkedInSession();
await session.launch();
if (!(await session.isLoggedIn())) {
  console.error('✖ NON loggato — mi fermo, nessuna azione');
  await session.close();
  process.exit(2);
}
console.log('✓ sessione LinkedIn attiva\n');

for (const t of targets) {
  const p = session.page!;
  const tokens = S.tokensOf(t.full_name);
  await p.goto(t.profile_url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await H.shortPause(1800, 3200);

  const sig = await detectGuards(p);
  if (sig) {
    console.log(`${t.full_name}\n   ⛔ BLOCCO: ${sig.kind} — ${sig.detail ?? ''}\n`);
    break;
  }
  await H.humanScroll(p, randInt(1, 2));

  let probe = await S.probeTopCard(p, tokens, 20_000);
  let via = 'top-card';
  if (probe.kind === 'none') {
    const more = S.moreButton(p);
    if (await more.isVisible({ timeout: 3000 }).catch(() => false)) {
      await H.humanClick(more);
      await H.shortPause(1200, 2200);
      const inMenu = await S.probeTopCard(p, tokens, 10_000);
      if (inMenu.kind !== 'none' || inMenu.labels.connected) {
        probe = { ...inMenu, labels: { ...probe.labels, ...inMenu.labels } };
        via = 'menu Altro';
      }
      await p.keyboard.press('Escape').catch(() => {});
    }
  }

  const stato =
    probe.kind === 'pending' ? 'GIÀ PENDENTE' :
    probe.kind === 'connect' ? `INVITABILE (${via})` :
    probe.labels.connected || probe.labels.message ? 'GIÀ COLLEGATO (1° grado)' : 'INDETERMINATO';

  console.log(`${t.full_name}  →  ${stato}`);
  console.log(`   url      : ${t.profile_url}`);
  console.log(`   label    : ${probe.label ?? '—'}`);
  console.log(`   labels   : ${JSON.stringify(probe.labels)}`);
  if (probe.kind === 'none' && !probe.labels.connected && !probe.labels.message) {
    console.log(`   viste    : ${JSON.stringify(probe.sample)}`);
  }
  console.log();
  await H.shortPause(4000, 8000);
}

await session.close();
console.log('— probe terminato, NESSUNA azione eseguita —');
