---
name: linkedin-outreach
description: Playbook per usare il server MCP LinkedIn Sequencer — preparare la lista di contatti, scrivere i messaggi, leggere i numeri giusti e riparare i selettori quando LinkedIn cambia il DOM. Usalo quando l'utente vuole mandare richieste di collegamento o messaggi su LinkedIn con questo tool.
---

# Outreach LinkedIn con LinkedIn Sequencer

Il server MCP porta già il suo manuale nelle `instructions` (ordine delle operazioni, limiti,
gestione dell'HALT). Questa skill copre quello che le istruzioni non possono dire: come si
prepara una campagna che funziona e come si legge il risultato.

## Preparare la lista

Prima di importare, guarda il CSV. Serve solo la colonna con l'URL del profilo, ma la qualità
delle altre decide la qualità dei messaggi:

- `nome` separato da `cognome` rende `{firstName}` affidabile. Con il solo `full_name` il tool
  prende la prima parola: su "Dott. Marco Bianchi" diventa "Dott.".
- Ogni colonna extra diventa `{custom.NOME_COLONNA}`. Una colonna `Settore` o `Evento` vale più
  di dieci righe di messaggio generico.
- Dopo `import_contacts` controlla `rows_invalid` e `rows_url_inferred`. Le righe "inferred"
  avevano solo uno slug: se sono tante, quasi sempre la colonna sbagliata è finita nell'URL.

Mostra sempre l'anteprima all'utente prima di iscrivere i contatti a una campagna.

## Scrivere il primo messaggio

Va nel passo dopo l'accettazione, mai nella nota dell'invito (5 note al mese sugli account free).

Regole che spostano l'acceptance rate più di qualsiasi impostazione:

- **Spintax obbligatorio** sull'apertura: `{Ciao|Salve|Buongiorno} {firstName}`. Messaggi
  identici inviati in massa sono uno dei segnali di bot più forti.
- **Una ragione specifica** per aver scritto proprio a quella persona: `{company}`,
  `{headline}` o una colonna custom. Se il messaggio funziona identico per chiunque, non funziona.
- **Niente pitch al primo messaggio.** L'obiettivo del primo messaggio è una risposta, non una call.
- Tieniti sotto le 400 battute.

Prima di lanciare, fai vedere all'utente il messaggio renderizzato su 2–3 contatti veri della
sua lista, non su un esempio inventato.

## Leggere i numeri

Con `get_metrics`, l'unico numero che conta davvero è l'**acceptance rate**:

| Cosa vedi | Cosa significa | Cosa fare |
|---|---|---|
| > 60% | targeting azzeccato | si può salire di volume, con gradualità |
| 40–60% | normale | non toccare niente |
| < 40% | il problema è la lista o il messaggio | il controller frena da solo: non forzarlo, sistema il targeting |
| segnali in `signals_7d` | LinkedIn si è accorto di qualcosa | abbassa i volumi, non alzarli |

Se l'utente chiede più volume mentre l'acceptance rate è basso, dillo: aumentare gli inviti con
un tasso di accettazione basso è esattamente il comportamento che porta alla restrizione, perché
la quota di inviti ignorati è uno dei tre trigger dichiarati da LinkedIn.

## Quando i selettori si rompono

Sintomo: `get_recent_actions` mostra `connect / failed` con "nessun Invite … to connect" su
**tutti** i contatti (su uno solo è normale: profilo già collegato o fuori rete).

Il ciclo di riparazione, dalla cartella del progetto:

```bash
npx tsx scripts/probe-targets.ts targets.json   # guarda il DOM reale
# correggi src/linkedin/selectors.ts
npm run test:selectors                          # regressioni su DOM sintetico
npx tsx scripts/connect-no-note.ts targets.json 0   # un invio reale isolato
```

Due invarianti da non rompere mai mentre si correggono i selettori:

1. **Ancoraggio al nome.** Ogni controllo va cercato per `aria-label` contenente i token del nome
   della persona bersaglio. La sidebar "More profiles for you" ha i suoi "Connect": senza
   ancoraggio si invita uno sconosciuto. Se il nome non è ricavabile, non cliccare niente.
2. **Mai `click({ force: true })`.** Clicca alle coordinate e, con la top-nav sticky sovrapposta,
   colpisce il banner "Claim Premium Page" portando al checkout Premium.

## Cosa non fare

- Non promettere all'utente che il suo account non verrà limitato.
- Non citare volumi presi da blog di vendor ("100 inviti a settimana"): LinkedIn non pubblica
  limiti numerici.
- Non azzerare un HALT prima che l'utente abbia davvero risolto la segnalazione su LinkedIn.
- Non avviare campagne su liste che l'utente non ha motivo legittimo di contattare.
