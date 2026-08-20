# LinkedIn Sequencer MCP

Server **MCP** che automatizza l'outreach su LinkedIn **dal computer dell'utente**, comandato
interamente da chat dentro Claude Code, Codex o qualunque client MCP.

Accedi una volta a LinkedIn, passi una lista di contatti, e il tool manda le richieste di
collegamento — lentamente, dentro orari lavorativi, con una rampa di warm-up e un controller
che frena da solo quando LinkedIn dà segnali di fastidio.

Nessuna API LinkedIn, nessun token, nessuna password: pilota una finestra di **Chrome reale**
con Playwright, usando la tua sessione e il tuo IP.

```
tu:      "importa ~/contatti.csv e comincia a mandare le richieste"
Claude:  → import_contacts → create_campaign → enroll_contacts → engine_control start
         "Campagna creata: 180 contatti. Fino a 12 inviti oggi, lun–ven 9–18."
```

---

## ⚠️ Leggi prima questo (onestà sui rischi)

- **Automatizzare LinkedIn viola il suo User Agreement** (§8.2: vietati "bot o metodi
  automatizzati per accedere al servizio, aggiungere contatti, inviare messaggi"). La sanzione
  va dalla restrizione temporanea al **ban permanente**.
- **Nessuno può garantirti che non verrai bannato** — nemmeno i tool a pagamento. Questo
  strumento *riduce* il rischio con volumi bassi e comportamento umano, non lo azzera.
- ⚠️ **Attenzione ai numeri che girano online.** "100–200 inviti/settimana", "75/giorno",
  "recupero <15%" sono cifre da blog di vendor di automazione, senza fonte primaria.
  **LinkedIn non pubblica alcun limite numerico** di inviti, né settimanale né sul totale
  dei pendenti, e dichiara di non poter mostrare quanto ti resta.
  Non progettare la tua sicurezza su quei numeri.

### Cosa dice davvero LinkedIn (fonti dirette)

- Tre trigger dichiarati per la restrizione degli inviti: molti inviti in poco tempo; alta quota
  di inviti ignorati o segnalati come spam; **"using automation tools to send invitations"**
  ([Help a551012](https://www.linkedin.com/help/linkedin/answer/a551012)).
- Una restrizione **dura tipicamente una settimana**, LinkedIn **non può accorciarla** e il
  Supporto non rivela il motivo. Scala fino a **un mese** per troppi inviti pendenti.
- **Ritirare gli inviti pendenti NON toglie la restrizione**, e dopo un ritiro non puoi
  reinvitare la stessa persona per **~3 settimane**
  ([Help a550555](https://www.linkedin.com/help/linkedin/answer/a550555)).
- Gli account **free** possono allegare una nota personalizzata a soli **5 inviti al mese**
  (illimitati con Premium). Il tetto è **mensile**, non settimanale.
- Il limite di rete resta **30.000 collegamenti di 1° grado**.

I tetti configurati in questo tool (`weeklyInviteCeiling`, `caps`, rampa) sono **scelte di
prudenza**, non soglie note di LinkedIn. Il segnale utile da guardare è l'**acceptance rate**,
non un numero preso da un blog.

Usalo in modo responsabile, sul **tuo** account, a tuo rischio.

---

## Requisiti

- **Node.js ≥ 22.22.2** (richiesto da `mcp-use` v2)
- **Google Chrome** installato (consigliato) oppure il Chromium di Playwright
- macOS o Linux (su Windows manca l'installazione del servizio; il resto funziona)

## Installazione

La repo è privata: serve accesso in lettura su GitHub.

```bash
npm install -g "git+ssh://git@github.com/matteolegrottaglie/Linkedin-Sequencer-MCP.git"
```

Poi la configurazione iniziale:

```bash
lksq setup
```

Crea `~/.linkedin-sequencer-mcp/`, genera il token di accesso, verifica il browser e stampa i
prossimi passi. Se non hai Chrome:

```bash
npx playwright install chromium
```

## Collegare il client MCP

Avvia il daemon e chiedi la configurazione:

```bash
lksq daemon start && lksq mcp-config
```

**Claude Code**

```bash
claude mcp add --transport http linkedin-sequencer http://127.0.0.1:4311/mcp --header "Authorization: Bearer IL_TUO_TOKEN"
```

**Codex** — in `~/.codex/config.toml`:

```toml
[mcp_servers.linkedin_sequencer]
url = "http://127.0.0.1:4311/mcp"
bearer_token_env_var = "LKSQ_TOKEN"
```

`lksq mcp-config` stampa entrambe le righe già compilate con il tuo token.

> Il token vive in `~/.linkedin-sequencer-mcp/token` con permessi `0600`. Non condividerlo:
> chi ce l'ha può mandare inviti e messaggi a tuo nome.

## Uso, da chat

**1. Accedi a LinkedIn** (una volta sola)

> «accedi a LinkedIn»

Si apre una finestra di Chrome sulla pagina di login: accedi normalmente, anche con Google e 2FA.
È l'unico momento in cui vedi il browser — appena sei dentro, la finestra si chiude e da lì in
poi il tool lavora in background.
Il tool non vede né salva la password — conserva solo la sessione del browser, in locale.
Dalle volte successive risulti già connesso.

**2. Importa la lista e parti**

> «importa ~/Desktop/contatti.csv e comincia a mandare le richieste di collegamento;
> dopo che accettano scrivi: "Ciao {firstName}, grazie del collegamento!"»

**3. Controlla come sta andando**

> «a che punto siamo?» · «quanti inviti ho mandato questa settimana?» · «com'è l'acceptance rate?»

**4. Frena o fermati**

> «abbassa a 8 inviti al giorno» · «metti in pausa» · «ferma tutto»

### Perché è così lento

Una azione alla volta, 40 secondi–3 minuti di pausa fra una e l'altra, pause lunghe ogni 6–12
azioni, e solo dentro la finestra oraria (default lun–ven 9–18). **La lentezza è la protezione**:
raffiche e attività notturna sono i segnali di bot più facili da rilevare. Una lista di 200
contatti richiede settimane, non ore.

### Il browser non si vede

Il tool lavora in background: nessuna finestra che compare o si muove mentre stai facendo
altro. L'unica volta che vedi Chrome è il login, perché le credenziali le digiti tu.

Non è il vecchio headless facilmente rilevabile, ed è una differenza che vale la pena spiegare
perché è la scelta tecnica su cui si regge tutto:

- gira il **Chrome di sistema**, non un Chromium di automazione — il renderer WebGL riportato è
  quello vero della tua GPU
- lo **User-Agent viene ripulito** dalla stringa `Headless`, header HTTP e client hints inclusi
- i valori del **display reale** (profondità colore) vengono osservati durante il login e
  riprodotti in background

Misurato sui segnali che un anti-bot guarda per primi — `navigator.webdriver`, plugin, lingue,
User-Agent, client hints, renderer WebGL, profondità colore, dimensioni finestra — dopo il primo
login il fingerprint in background è **identico** a quello a finestra aperta.

Se vuoi comunque vedere cosa fa, `HEADFUL=true` riapre la finestra: serve soprattutto quando un
selettore smette di funzionare e vuoi guardare la pagina con i tuoi occhi.

## Far avanzare le campagne a client chiuso

Le sequenze durano giorni (attesa di accettazione, rampa di warm-up). Perché avanzino anche
quando chiudi Claude Code, installa il daemon come servizio dell'utente:

```bash
lksq service install
```

Su macOS crea un LaunchAgent, su Linux una systemd user unit. Il servizio avvia anche il motore
all'accesso, e le campagne procedono da sole in background, sempre dentro finestra oraria, rampa
e tetti. Con `--no-autostart` tiene acceso solo il server MCP.

```bash
lksq service uninstall   # per tornare indietro
```

---

## Formato CSV

Serve almeno la colonna con l'URL del profilo. Intestazioni riconosciute in italiano e inglese,
senza distinzione di maiuscole.

```csv
profile_url,nome,cognome,azienda,qualifica,settore
https://www.linkedin.com/in/mario-rossi/,Mario,Rossi,Acme,CEO @ Acme,Manifattura
linkedin.com/in/giulia-bianchi,Giulia,Bianchi,Beta Srl,CTO,Software
```

| Campo | Intestazioni accettate |
|---|---|
| URL profilo *(obbligatorio)* | `profile_url`, `url`, `linkedin`, `linkedin url`, `profilo`, `profile`, `link` |
| Nome | `first_name`, `firstname`, `nome` |
| Cognome | `last_name`, `lastname`, `cognome` |
| Nome completo | `full_name`, `name`, `nominativo` |
| Azienda | `company`, `azienda`, `organizzazione` |
| Qualifica | `headline`, `titolo`, `qualifica`, `ruolo`, `title` |
| Località | `location`, `località`, `city`, `città` |
| Email | `email`, `e-mail`, `mail` |

Qualsiasi altra colonna diventa `{custom.NOME_COLONNA}`, usabile nei template.

> Se una riga contiene solo uno *slug* (`mario-rossi`) invece di un URL, viene ricostruita come
> profilo ma segnalata nel risultato dell'import: controlla che sia un profilo vero, perché un
> refuso in quella colonna passerebbe altrimenti inosservato.

### Template dei messaggi

- Placeholder: `{firstName}` `{lastName}` `{fullName}` `{company}` `{headline}` `{location}` `{custom.NOME}`
- **Spintax** (variazione anti-pattern): `{Ciao|Salve|Buongiorno} {firstName}!`

Messaggi identici inviati in massa sono uno dei segnali di bot più forti: usa lo spintax.

---

## La sequenza consigliata (e perché)

```
visita profilo → attesa 1 giorno → collegati SENZA nota → attendi accettazione (14g) → primo messaggio
```

La nota personalizzata **non va nell'invito**: sugli account free ne hai solo 5 al mese.
La personalizzazione vive nel **primo messaggio dopo l'accettazione**, dove non costa nulla.

È la sequenza che `create_campaign` e `start_connection_campaign` usano di default.

## Il controller di sicurezza

- **Rampa**: inviti/giorno per settimana di warm-up (default 12 → 16 → 18 → 20 → 22 → 25).
- **Tetto settimanale**: limite duro che non viene mai superato (default 100).
- **Acceptance rate**: se scende sotto la soglia (default 40%) il controller **riduce** gli inviti.
- **Backoff**: su "limite settimanale" o warning sospende gli inviti e abbassa il tetto.
- **HALT**: su captcha o restrizione si ferma del tutto. Sopravvive ai riavvii: devi risolvere
  la segnalazione su LinkedIn e solo dopo azzerarlo. È voluto.
- **Recupero**: dopo N giorni "puliti" rialza gradualmente i limiti.
- **Auto-withdraw**: ritira gli inviti pendenti troppo vecchi per tenere sano il backlog.

Tutto leggibile e modificabile da chat con `get_safety_settings` / `update_safety_settings`.

---

## Tool MCP

| Gruppo | Tool |
|---|---|
| Autenticazione | `linkedin_auth_status` · `linkedin_login` · `linkedin_logout` |
| Contatti | `import_contacts` · `list_contacts` · `delete_contacts` |
| Campagne | `create_campaign` · `list_campaigns` · `get_campaign` · `update_campaign` · `set_campaign_status` · `delete_campaign` · `enroll_contacts` |
| Motore | `engine_status` · `engine_control` |
| Sicurezza | `get_safety_settings` · `update_safety_settings` |
| Metriche | `get_metrics` · `get_recent_actions` · `get_signals` |
| Percorso rapido | `start_connection_campaign` |

## Comandi `lksq`

```bash
lksq setup                       # configurazione iniziale
lksq daemon start|stop|status    # daemon in background
lksq start                       # daemon in primo piano
lksq logs -f                     # segui il log
lksq login                       # login da terminale (a daemon fermo)
lksq mcp-config                  # configurazione per Claude Code e Codex
lksq service install|uninstall   # esecuzione non presidiata
lksq doctor                      # diagnosi dell'installazione
```

## Dove stanno i dati

Tutto in `~/.linkedin-sequencer-mcp/` (o in `LKSQ_DATA_DIR`):

```
sequencer.db       contatti, campagne, azioni, segnali, impostazioni
browser-profile/   sessione LinkedIn (è il tuo login: trattalo come una password)
token              token bearer dell'endpoint MCP (0600)
screenshots/       schermate salvate quando un'azione fallisce
daemon.log
```

Nessuno di questi file lascia mai il tuo computer.

### Vieni dal progetto originale?

Se hai già una sessione LinkedIn e un database nella vecchia cartella `data/`, puntaci
`LKSQ_DATA_DIR` invece di ricominciare da capo:

```bash
export LKSQ_DATA_DIR="$HOME/Progetti/Linkedin Sequencer/data"
lksq doctor
```

Ritrovi login, contatti, campagne e storico delle azioni. Lo schema del database è lo stesso.

---

## Architettura

```
lksq start
  └─ daemon (un processo)
       ├─ SQLite            contatti, campagne, azioni, impostazioni
       ├─ Engine            worker loop: una azione alla volta, con ritardi umani
       ├─ Playwright        Chrome reale, profilo persistente
       └─ MCPServer         http://127.0.0.1:4311/mcp   (mcp-use v2, Streamable HTTP)
```

Un **daemon** e non un server MCP effimero perché le campagne durano giorni e Playwright
blocca il profilo browser a un solo processo: login, motore e tool devono vivere insieme.
`mcp-use` v2 non offre il transport stdio, ma sia Claude Code sia Codex parlano Streamable HTTP.

```
src/
  cli.ts               comando `lksq`
  daemon.ts            processo daemon
  config.ts            percorsi, porta, token, default di sicurezza
  mcp/                 server MCP: istruzioni, schemi zod, tool
  service/             logica applicativa condivisa dai tool
  safety/controller.ts controller adattivo (cuore anti-ban)
  sequencer/engine.ts  worker loop
  browser/             sessione persistente, stealth, comportamento umano
  linkedin/            selettori (FRAGILI), guardie, azioni Playwright
  db/  importer/  util/  platform/
scripts/               strumenti di manutenzione dei selettori (vedi sotto)
skills/                playbook installabile come skill di Claude Code
test/                  node:test, logica pura senza browser
```

## Quando qualcosa si rompe (selettori)

È **la** manutenzione ricorrente di questo progetto: LinkedIn cambia il DOM e i selettori
smettono di agganciare. Se un'azione fallisce, l'engine salva uno **screenshot** e il percorso
compare in `get_recent_actions`, insieme all'elenco degli `aria-label` che ha visto in pagina.

### Come sono fatti i selettori, e perché

Riscritti il 2026-08-20 dopo probing del DOM dal vivo, e verificati sul campo con invii reali.
Due cose da sapere prima di toccarli:

- **Non si seleziona per ruolo.** I controlli della top-card non sono `<button>`: "Connect" è un
  `<a>` con `aria-label="Invite <Nome> to connect"` e senza `role="button"`. La vecchia
  `getByRole('button', { name: /^connect$/ })` restituiva zero risultati — era il bug.
- **Ogni selettore è ancorato ai token del nome della persona.** La sidebar "More profiles for
  you" ha i suoi "Connect": senza ancoraggio si finisce per invitare qualcun altro. Se il nome
  non è ricavabile, il tool **non clicca niente** e riporta il fallimento.

Altre due invarianti che sembrano dettagli e non lo sono: mai `click({ force: true })` (clicca
alle coordinate e con la top-nav sticky sovrapposta colpisce il banner "Claim Premium Page",
portando al checkout Premium — è successo davvero); e dopo ogni click si verifica di non essere
finiti su una pagina Premium/checkout, nel qual caso ci si ferma.

### Il ciclo di riparazione

```bash
# 1. guarda com'è fatta la pagina adesso, su profili veri
npx tsx scripts/probe-targets.ts targets.json

# 2. correggi src/linkedin/selectors.ts

# 3. verifica la logica su DOM sintetico (niente rete, niente account)
npm run test:selectors

# 4. prova un invio reale isolato, fuori dall'engine
npx tsx scripts/connect-no-note.ts targets.json 0
```

`scripts/selectors-fixture-test.ts` blocca le regressioni già viste (il Connect della sidebar,
il banner Premium sticky, la "Send" nascosta che rubava il match). Va rilanciato ogni volta che
si tocca `selectors.ts`. Un fixture verde non garantisce che la UI vera sia ancora così: quello
lo dice solo il passo 1.

## Sviluppo

```bash
npm install
npm run typecheck
npm test               # logica pura: template, CSV, controller di sicurezza
npm run test:selectors # selettori su DOM sintetico (serve un browser)
npm run build
npm run dev            # daemon in primo piano
```

Se `npm run test:selectors` non trova il browser di Playwright, puoi puntarlo a Chrome:

```bash
PW_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:selectors
```

Per lavorare senza toccare i dati veri:

```bash
LKSQ_DATA_DIR=/tmp/lksq-dev LKSQ_PORT=4399 npm run dev
```

## Disclaimer

Strumento personale ed educativo. L'uso viola i Termini di LinkedIn e può causare la sospensione
del tuo account. Chi lo distribuisce e chi lo usa se ne assumono ogni responsabilità.
Volumi bassi, gradualità, buon senso.
