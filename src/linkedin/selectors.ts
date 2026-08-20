// ============================================================
//  Selettori LinkedIn — CENTRALIZZATI perché FRAGILI.
//
//  RISCRITTO il 2026-08-20 dopo probing del DOM dal vivo.
//  Implementazione di riferimento: scripts/connect-no-note.ts.
//
//  COSA ERA ROTTO — tutto passava da getByRole('button', { name }).
//  Nella UI attuale i controlli della top-card NON sono <button>:
//  "Connect" è un <a> con aria-label "Invite <Nome> to connect" e
//  senza role="button", quindi getByRole('button') dava 0 risultati.
//  In più il nome accessibile non è "Connect" ma "Invite <Nome> to
//  connect": la vecchia regex ancorata /^connect$/ non matchava mai.
//
//  REGOLE DI QUESTO FILE
//   1. Si seleziona per aria-label, non per ruolo.
//   2. L'aria-label va SEMPRE ancorato ai token del nome della
//      persona bersaglio: la sidebar "More profiles for you" ha i
//      suoi "Connect" e non vanno MAI cliccati.
//   3. Regex sempre IT + EN: l'account rende la UI in inglese anche
//      con locale it-IT impostato in session.ts (verificato).
//   4. Il nome NON è dentro un <h1>: non ancorarsi mai a 'main h1'.
//   5. Dentro page.evaluate NIENTE funzioni con nome (né dichiarate
//      né assegnate a const): tsx/esbuild con keepNames inietta
//      l'helper __name, che nel contesto pagina non esiste
//      (ReferenceError). Solo arrow anonime passate come argomento.
//   6. Le RegExp non attraversano il confine Node↔pagina: si passa
//      `.source` e si ricostruisce con new RegExp() dentro evaluate.
// ============================================================
import type { Page, Locator } from 'playwright';
import type { Contact } from '../types.js';

export const RX = {
  // --- aria-label della top-card ---------------------------------
  // Confrontate contro l'aria-label NORMALIZZATO (NFD senza accenti,
  // minuscolo): scrivile minuscole e senza flag /i.
  connectLabel: /invite .* to connect|invita .* a collegarsi/,
  pendingLabel: /(^|\W)(pending|in attesa)(\W|$)/,
  messageLabel: /^(message|messaggia|invia un messaggio a)\b/,
  followLabel: /^(follow|segui)\b/,
  /** Solo nel menu "Altro" di un collegamento di 1° grado. */
  connectedLabel: /remove (your )?connection|rimuovi (il )?collegamento/,
  /** Per la diagnostica: quali aria-label vale la pena riportare. */
  interestingLabel: /connect|collegarsi|pending|in attesa|message|messaggia|follow|segui/,

  // --- testi dei controlli della modale invito -------------------
  // Nemmeno questi sono <button>: si selezionano per TESTO esatto.
  sendWithoutNote: /^\s*(send without a note|invia senza nota|invia ora|send now)\s*$/i,
  addNote: /^\s*(add a note|aggiungi una nota|aggiungi nota)\s*$/i,
  send: /^\s*(send|invia)\s*$/i,
  withdraw: /^\s*(withdraw|ritira|annulla invito|ritira invito)\s*$/i,
  like: /^\s*(like|consiglia|mi piace)\s*$/i,

  /** URL da cui bisogna scappare subito: il click è finito fuori strada. */
  offProfileUrl: /\/premium\/|\/checkout|\/payment|upsell/i,
} as const;

// ============================================================
//  Ancoraggio al nome
// ============================================================

/** Token significativi di un nome: minuscolo, senza accenti né punteggiatura. */
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
 * Token da usare per ancorare i selettori a QUESTA persona.
 * Fallback allo slug dell'URL (/in/nome-cognome-1a2b3c/) scartando
 * i pezzi che contengono cifre (l'hash finale di LinkedIn).
 *
 * Se torna [] non si deve cliccare NULLA: senza ancoraggio al nome
 * il rischio è colpire il "Connect" di un profilo della sidebar.
 */
export function tokensForContact(contact: Contact): string[] {
  const named = contact.full_name ?? [contact.first_name, contact.last_name].filter(Boolean).join(' ');
  const fromName = named ? tokensOf(named) : [];
  if (fromName.length > 0) return fromName;

  const slug = /\/in\/([^/?#]+)/i.exec(contact.profile_url)?.[1] ?? contact.public_id ?? '';
  return tokensOf(decodeURIComponent(slug).replace(/-/g, ' ')).filter((t) => !/\d/.test(t));
}

// ============================================================
//  Probe della top-card
// ============================================================

export type InviteState = 'connect' | 'pending' | 'none';

export interface TopCardProbe {
  /** Stato dell'invito per QUESTA persona. */
  kind: InviteState;
  /** aria-label esatto del controllo connect/pending (da passare a byExactLabel). */
  label: string | null;
  /** aria-label esatti di tutti i controlli ancorati al nome trovati. */
  labels: {
    connect?: string;
    pending?: string;
    message?: string;
    follow?: string;
    connected?: string;
  };
  /** aria-label "interessanti" viste in pagina — solo per diagnostica. */
  sample: string[];
}

const EMPTY_PROBE: TopCardProbe = { kind: 'none', label: null, labels: {}, sample: [] };

/**
 * Cerca i controlli della top-card ancorandoli ai token del nome.
 *
 * Fa polling finché non trova qualcosa di ancorato al nome (la
 * top-card è idratata in ritardo) oppure finché non scade il timeout.
 * Basta UN controllo ancorato al nome — anche solo "Message" — per
 * considerare la top-card renderizzata e uscire subito: senza questo
 * i profili già di 1° grado aspetterebbero il timeout intero.
 */
export async function probeTopCard(page: Page, tokens: string[], timeoutMs = 15_000): Promise<TopCardProbe> {
  if (tokens.length === 0) return EMPTY_PROBE; // senza ancoraggio non si guarda nemmeno

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
          // Le RegExp non sopravvivono al confine Node->pagina: qui si
          // ricostruiscono dai `.source` passati come stringhe.
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
              // la top-card sta in <main>; "More profiles for you" in <aside>
              inMain: !!e.closest('main') && !e.closest('aside'),
            }));

          // Prima i controlli della top-card, poi il resto: se due
          // persone condividono i token del nome vince quella del profilo.
          const ranked = items.filter((i) => i.inMain).concat(items.filter((i) => !i.inMain));
          const mine = ranked.filter((i) => arg.toks.every((t) => i.norm.includes(t)));

          // pending PRIMA di connect: "Pending, click to withdraw
          // invitation sent to <Nome>" contiene comunque "invitation".
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
            sample: items
              .filter((i) => rxInteresting.test(i.norm))
              .map((i) => i.raw)
              .slice(0, 10),
          };
        },
        { toks: tokens, rx: patterns },
      )
      .catch(() => null); // navigazione in corso: si riprova al giro dopo

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

/** Locator per aria-label ESATTO — l'unico modo sicuro di ri-agganciare ciò che il probe ha trovato. */
export function byExactLabel(page: Page, label: string): Locator {
  return page.locator(`[aria-label="${label.replace(/["\\]/g, '\\$&')}"]`).first();
}

// ============================================================
//  Controlli non ancorabili al nome
// ============================================================

/**
 * Menu "Altro" della top-card. aria-label ESATTO "More" (o "Altro"):
 * alcuni profili (es. 3° grado) non espongono affatto "Connect" nella
 * top-card e lo tengono solo qui dentro, come <a role="menuitem">
 * contenente un <div aria-label="Invite <Nome> to connect">.
 */
export function moreButton(page: Page): Locator {
  return page.locator('[aria-label="More"], [aria-label="Altro"]').first();
}

// --- modale invito (controlli selezionati per TESTO, non sono <button>) ---
//
// Volutamente NON si limita la ricerca a [role="dialog"]: non è
// verificato che la modale invito esponga quel ruolo, e sbagliare
// scope significherebbe non inviare più nulla. Il filtro `visible`
// serve invece a non farsi rubare il match da un omonimo NASCOSTO
// più in alto nel DOM (es. la "Send" dell'overlay messaggi chiuso):
// getByText matcha anche gli elementi invisibili.
// Rete di sicurezza vera: dopo il click si riverifica il "Pending".
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

// --- conferma ritiro invito ---
export function withdrawConfirmControl(page: Page): Locator {
  return byVisibleText(page, RX.withdraw);
}

// --- messaggistica (overlay msg-form: qui i <button> ci sono ancora) ---
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

// --- like su un post recente (best-effort) ---
export function likeControl(page: Page): Locator {
  // aria-label "Like <Nome>'s post" / "React Like" / "Consiglia ...".
  // ^Like non matcha "Unlike": un post già apprezzato viene ignorato.
  return page
    .locator(
      '[aria-label^="React Like" i], [aria-label^="Like" i], [aria-label^="Consiglia" i], [aria-label^="Mi piace" i]',
    )
    .filter({ visible: true })
    .first();
}
