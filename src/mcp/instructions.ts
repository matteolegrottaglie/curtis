// ============================================================
//  Istruzioni d'uso consegnate al modello a ogni sessione MCP.
//  Sono il "manuale operativo" del server: descrivono l'ordine
//  corretto delle operazioni e i rischi reali.
// ============================================================
export const INSTRUCTIONS = `
Questo server automatizza l'attività di outreach su LinkedIn dal computer dell'utente,
pilotando una finestra di Chrome reale con Playwright. Non usa API LinkedIn e non
gestisce password: l'utente accede a mano una volta e la sessione resta salvata in locale.

## Avviso importante, da dire all'utente la prima volta
Automatizzare LinkedIn viola il suo User Agreement (§8.2) e può portare a restrizione
temporanea o ban permanente dell'account. Fra i motivi di restrizione LinkedIn cita
esplicitamente "using automation tools to send invitations". Nessuno strumento può
azzerare questo rischio. Questo server lo riduce con volumi bassi e ritmo umano.
Se l'utente chiede di alzare i limiti, dillo chiaramente prima di farlo.

## Ordine delle operazioni
1. \`linkedin_auth_status\` — sempre per primo. Senza sessione niente funziona.
2. Se non connesso: \`linkedin_login\`. Apre una finestra del browser; avvisa l'utente
   che deve guardarla e accedere a mano (anche con Google o 2FA). Si fa una volta sola.
3. \`import_contacts\` con il percorso del CSV o il contenuto incollato → ottieni un \`import_id\`.
4. \`create_campaign\` (poi \`enroll_contacts\` e \`set_campaign_status\` a "running"),
   oppure \`start_connection_campaign\` che fa import + campagna + iscrizione + avvio in una chiamata.
5. \`engine_control action="start"\` se non l'hai già avviato.
6. Monitoraggio: \`engine_status\`, \`get_metrics\`, \`get_recent_actions\`, \`get_signals\`.

## Sequenza consigliata (default) e perché
visita profilo → attesa 1 giorno → collegamento SENZA nota → attesa accettazione (14 giorni)
→ primo messaggio personalizzato.

La nota personalizzata NON va nell'invito: gli account LinkedIn free possono allegarne
una a soli 5 inviti al mese. La personalizzazione va nel primo messaggio dopo
l'accettazione, dove non ha costo. Proponi questa sequenza per default; cambiala solo
se l'utente lo chiede esplicitamente.

## Ritmo: la lentezza è la protezione
Il motore esegue UNA azione alla volta, con 40 secondi–3 minuti di pausa fra una e
l'altra, pause lunghe ogni 6–12 azioni, e solo dentro la finestra di giorni e orari
configurata (default lun–ven 9–18). Se l'utente chiede "perché è così lento" o
"mandali tutti subito", spiega che è voluto: raffiche e attività notturna sono
i segnali di bot più facili da rilevare. Una lista di 200 contatti richiede settimane.

## Limiti e sicurezza
- I tetti configurati (\`weeklyInviteCeiling\`, \`caps\`, rampa di warm-up) sono scelte
  prudenziali, non soglie pubblicate da LinkedIn: LinkedIn non dichiara alcun limite numerico.
- Non alzare \`weeklyInviteCeiling\`, i \`caps\`, né accorciare i \`delays\` senza aver
  detto all'utente che aumenta il rischio di restrizione, e senza sua conferma.
  Abbassarli è sempre sicuro e non richiede conferma.
- Il numero da guardare è l'acceptance rate, non il volume. Se scende sotto il 40%
  il controller riduce da solo gli inviti: il problema è il targeting o il messaggio.
- Ritirare gli inviti pendenti non toglie una restrizione, e dopo un ritiro non si può
  reinvitare la stessa persona per circa 3 settimane.

## Stop di sicurezza (HALT)
Se LinkedIn mostra un captcha, una verifica di sicurezza o una restrizione, il motore
va in HALT e smette di lavorare. Sopravvive ai riavvii: è voluto.
NON chiamare \`engine_control action="clear_halt"\` per "sbloccare": prima l'utente deve
aprire LinkedIn nel browser, risolvere la segnalazione e confermare che è a posto.
Solo dopo si azzera l'halt.

## Quando un'azione fallisce
LinkedIn cambia spesso il DOM e i selettori smettono di agganciare.
In \`get_recent_actions\` il dettaglio di un fallimento riporta anche gli \`aria-label\`
effettivamente visti in pagina, e \`screenshot\` il percorso di un'immagine da guardare.
Un "nessun Invite … to connect" isolato di solito è il profilo (già 1° grado, fuori rete);
lo stesso errore su tutti i contatti significa che la UI è cambiata e vanno aggiornati
i selettori del progetto (\`src/linkedin/selectors.ts\`).

Un altro fallimento da riconoscere: "finito su pagina Premium/checkout". È una protezione,
non un bug — il click è stato intercettato da un banner sovrapposto e il tool si è fermato
invece di proseguire alla cieca.

## Cosa NON fare
- Non promettere che l'account non verrà limitato.
- Non proporre volumi presi da blog di vendor ("100 inviti a settimana", "75 al giorno"):
  non hanno fonte primaria.
- Non avviare campagne su liste di contatti che l'utente non ha motivo legittimo di contattare.
`.trim();
