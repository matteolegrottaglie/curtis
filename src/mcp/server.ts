// ============================================================
//  Costruzione del server MCP (mcp-use v2).
//
//  Trasporto: HTTP su loopback. mcp-use v2 non offre stdio, ma sia
//  Claude Code (`--transport http`) sia Codex (`url = ...`) parlano
//  Streamable HTTP, e un daemon HTTP è comunque necessario: le
//  campagne durano giorni e devono sopravvivere alla chiusura del client.
// ============================================================
import { timingSafeEqual } from 'node:crypto';
import { MCPServer } from 'mcp-use';
import type { Engine } from '../sequencer/engine.js';
import { appConfig, getAuthToken } from '../config.js';
import { VERSION } from '../version.js';
import { INSTRUCTIONS } from './instructions.js';
import { registerAuthTools } from './tools/auth.js';
import { registerContactTools } from './tools/contacts.js';
import { registerCampaignTools } from './tools/campaigns.js';
import { registerEngineTools } from './tools/engine.js';
import { registerSafetyTools } from './tools/safety.js';
import { registerInsightTools } from './tools/insights.js';
import { registerQuickstartTools } from './tools/quickstart.js';

/** Confronto a tempo costante fra stringhe di lunghezza qualsiasi. */
function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Rotte pubbliche: non espongono nulla dell'account. */
const PUBLIC_PATHS = new Set(['/', '/healthz', '/favicon.ico']);

const LANDING_PAGE = `<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LinkedIn Sequencer MCP</title>
<style>
 :root{color-scheme:light dark}
 body{font:15px/1.6 system-ui,-apple-system,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.5rem}
 code{background:color-mix(in srgb,currentColor 12%,transparent);padding:.15em .4em;border-radius:.3em}
 .dot{display:inline-block;width:.6em;height:.6em;border-radius:50%;background:#22c55e;margin-right:.5em}
</style></head>
<body>
<h1><span class="dot"></span>LinkedIn Sequencer MCP</h1>
<p>Il daemon è attivo. L'endpoint MCP è <code>/mcp</code> e richiede un token bearer.</p>
<p>Non c'è un'interfaccia web: si comanda tutto da chat, in Claude Code o Codex.
Per la riga di configurazione esegui <code>lksq mcp-config</code>.</p>
</body></html>`;

export function buildMcpServer(engine: Engine): MCPServer {
  const token = getAuthToken();

  const server = new MCPServer({
    name: 'linkedin-sequencer',
    title: 'LinkedIn Sequencer',
    version: VERSION,
    description:
      'Automazione LinkedIn locale: login, import di liste di contatti e invio graduale di richieste di collegamento e messaggi, con limiti anti-ban.',
    instructions: INSTRUCTIONS,
    host: appConfig.host,
    port: appConfig.port,
    legacy: 'stateless',
    // La discovery automatica di `skills/` è relativa alla working directory,
    // che per un binario globale è arbitraria: il manuale operativo viaggia
    // nelle `instructions`, che arrivano sempre.
    skills: false,
  });

  // --- autenticazione dell'endpoint locale ---
  // Un server in loopback è raggiungibile da qualunque processo sulla macchina,
  // e qui "raggiungerlo" significa poter mandare inviti e messaggi a nome
  // dell'utente. Il token vive in <dataDir>/token con permessi 0600.
  server.use(async (c, next) => {
    if (token === null) return next();
    const path = new URL(c.req.url).pathname;
    if (PUBLIC_PATHS.has(path)) return next();

    const header = c.req.header('authorization') ?? '';
    const given = header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : (c.req.header('x-lksq-token') ?? '');
    if (!given || !tokenMatches(given, token)) {
      return c.json({ error: 'unauthorized', hint: 'esegui `lksq mcp-config` per il token' }, 401);
    }
    return next();
  });

  server.get('/', (c) => c.html(LANDING_PAGE));
  server.get('/healthz', (c) => c.json({ ok: true, name: 'linkedin-sequencer-mcp', version: VERSION }));

  registerAuthTools(server, engine);
  registerContactTools(server);
  registerCampaignTools(server);
  registerEngineTools(server, engine);
  registerSafetyTools(server);
  registerInsightTools(server);
  registerQuickstartTools(server, engine);

  return server;
}
