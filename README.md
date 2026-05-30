# LinkedIn Sequencer

Sequenziatore **personale** di richieste di collegamento e messaggi LinkedIn, in stile Dripify ma
locale e per un **singolo account** (il tuo). Automatizza il browser con **Playwright** simulando
comportamento umano. Nessuna API, nessun token, nessuna password salvata: usa la tua sessione
LinkedIn in un profilo Chrome reale.

---

## ⚠️ Leggi prima questo (onestà sui rischi)

- **Automatizzare LinkedIn viola lo User Agreement** (§8.2: vietati "bot o metodi automatizzati per
  accedere al servizio, aggiungere contatti, inviare messaggi"). La sanzione va dalla restrizione
  temporanea al **ban permanente** (recupero <15%).
- **Nessuno può garantirti che non verrai bannato** — nemmeno i tool a pagamento. Questo strumento
  *riduce* il rischio con volumi bassi e comportamento umano, non lo azzera.
- I **"75/giorno" pubblicizzati dai tool sono un tetto teorico**: LinkedIn impone ~**100–200 inviti a
  settimana** lato suo, e li throttla a monte. Il tasso d'invito *sostenibile* è ~100–150/settimana
  (~15–25/giorno) per un account in salute. Si sale **nel tempo**, guadagnando trust.
- Usalo in modo responsabile, sul **tuo** account, a tuo rischio.

---

## Come fa un tool cloud (Dripify) a reggere i volumi — e come lo replichiamo

| Leva di Dripify | Come la replichiamo in locale |
|---|---|
| IP dedicato residenziale, geo-coerente | **Il tuo IP residenziale reale** (gira sulla tua macchina): più autentico di un IP affittato |
| Cloud 24/7 | Gira quando il PC è acceso, **solo in orari lavorativi** (più umano) |
| "Activity Control" che alza/abbassa i limiti sui segnali | **Adaptive Limit Controller**: backoff sui warning, halt su captcha, recupero graduale |
| Mix di azioni (visite, follow, like, messaggi) | **Action-mix scheduler** con cap separati per tipo |
| Delay randomici, niente raffiche | Distribuzione ~gaussiana dei ritardi, pause lunghe, digitazione variabile |
| Warm-up graduale | **Rampa configurabile** per settimane, gated sull'**acceptance rate** |

La difesa vera è: **volumi bassi + ritmo umano + acceptance rate alto**. Quello fa salire il tuo
limite dinamico molto più di qualsiasi trucco.

---

## Requisiti

- **Node.js ≥ 20** (testato su 20.19)
- **Google Chrome** installato (consigliato) oppure il Chromium di Playwright
- macOS / Linux / Windows

> ⚠️ Sul tuo sistema `npx` risulta rotto: usa sempre gli script **`npm run ...`** (che risolvono i
> binari locali), mai `npx`.

## Installazione

```bash
npm install
npm run browser:install      # scarica Chromium (fallback se non usi Chrome)
cp .env.example .env         # poi adatta i valori se vuoi
```

## 1) Avvia la dashboard

```bash
npm start
```

Apri **http://127.0.0.1:4310**

## 2) Login (una sola volta) — dal tab «Account»

Nel tab **Account** (il primo) premi **«Accedi a LinkedIn con Google»**: si apre la finestra del browser
controllata dal tool. Lì scegli **«Continua con Google»** e accedi normalmente (anche 2FA). Quando la
dashboard mostra **«Connesso»** sei pronto. La sessione resta salvata in `data/browser-profile/`.

Dalle volte successive il tool si **riconnette da solo all'avvio** (auto-connect): vedrai «Connesso»
senza fare nulla. Per disattivarlo: `AUTO_CONNECT=false` nel `.env`.

> **Sicurezza:** il login lo fai *tu* nella finestra reale del browser. Il tool non vede né memorizza la
> tua password: usa solo la sessione del browser. (Mai incollare credenziali Google in form di terzi —
> verrebbe anche bloccato dall'anti-bot di Google.)
>
> In alternativa, da terminale e **a dashboard spenta**: `npm run login`.

## 3) Usa il tool

1. **Account** → connettiti a LinkedIn (vedi sopra).
2. **Contatti** → importa il CSV (vedi formato sotto).
2. **Sicurezza** → controlla rampa, orari, tetti. I default sono prudenti per account FREE.
3. **Campagne** → crea una sequenza, poi **"Iscrivi tutti i contatti"** e mettila in **Avvia**.
4. In alto premi **▶ Avvia** per far partire l'engine. Si apre il browser e inizia a lavorare,
   **solo dentro la finestra oraria** e dentro i limiti.
5. Guarda **Log live** e i KPI (inviti oggi / 7gg, pendenti, acceptance).

### Sequenza consigliata (sicura, account FREE)
`Visita profilo → Attesa 1 giorno → Collegati (senza nota) → Attendi accettazione (14g) → Messaggio personalizzato`

La nota personalizzata si mette nel **primo messaggio dopo l'accettazione**, non nella richiesta
(così eviti il taglio a ~5 inviti/settimana degli account FREE).

---

## Formato CSV

Colonne riconosciute (intestazioni IT/EN, case-insensitive). Solo `profile_url` è obbligatoria.

```csv
profile_url,first_name,last_name,company,headline
https://www.linkedin.com/in/mario-rossi/,Mario,Rossi,Acme,CEO @ Acme
https://www.linkedin.com/in/giulia-bianchi/,Giulia,Bianchi,Beta Srl,CTO
```

Qualsiasi colonna extra diventa `custom.NOME_COLONNA`, usabile nei template.

### Template messaggi / note
- Placeholder: `{firstName}` `{lastName}` `{fullName}` `{company}` `{headline}` `{location}` `{custom.NOME}`
- **Spintax** (variazione anti-pattern): `{Ciao|Salve|Buongiorno} {firstName}!`

---

## Pannello Sicurezza — cosa fa il controller

- **Rampa**: inviti/giorno per settimana di warm-up (default: 12 → 16 → 18 → 20 → 22 → 25).
- **Tetto settimanale**: limite "duro" che non viene mai superato (default 100). Alzalo solo col tempo.
- **Acceptance rate**: se scende sotto la soglia (default 40%) il controller **riduce** gli inviti.
- **Backoff**: su "limite settimanale"/warning sospende gli inviti e abbassa il tetto; su
  **captcha/restrizione** va in **HALT** totale (devi intervenire su LinkedIn e premere
  "⚠ Riprendi sicurezza").
- **Recupero**: dopo N giorni "puliti" rialza gradualmente i limiti.
- **Auto-withdraw**: ritira gli inviti pendenti troppo vecchi per tenere sano il backlog.

---

## Struttura del progetto

```
src/
  config.ts            config infrastruttura + default di sicurezza
  types.ts             tipi condivisi
  db/                  SQLite (schema, connessione, query)
  util/                rand (umano), time (fuso/finestra), log
  safety/controller.ts Adaptive Limit Controller (cuore anti-ban)
  browser/             sessione persistente, stealth, comportamento umano
  linkedin/            selettori (FRAGILI), guardie, azioni Playwright
  sequencer/           template, engine (worker loop)
  importer/csv.ts      import CSV
  server/              Fastify: API + SSE
  cli/login.ts         login manuale
  main.ts              entrypoint dashboard
public/                dashboard (HTML/CSS/JS, no build)
data/                  DB, profilo browser, screenshot (gitignored)
```

## Quando qualcosa si rompe (selettori)

LinkedIn cambia spesso il DOM. Se un'azione fallisce, l'engine salva uno **screenshot** in
`data/screenshots/` (visibile anche via `http://127.0.0.1:4310/screenshots/<file>.png`). Quasi sempre
basta aggiornare **un solo file**: `src/linkedin/selectors.ts`.

## Comandi

```bash
npm start             # avvia la dashboard
npm run dev           # dashboard con auto-reload
npm run login         # login manuale (a dashboard spenta)
npm run typecheck     # controllo dei tipi
npm run browser:install
```

## Disclaimer

Strumento educativo/personale. L'uso viola i Termini di LinkedIn e può causare la sospensione del tuo
account. L'autore/utilizzatore se ne assume ogni responsabilità. Usa volumi bassi, gradualità e buon
senso.
