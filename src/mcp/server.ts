// ============================================================
//  Building the MCP server (mcp-use v2).
//
//  Transport: HTTP on loopback. mcp-use v2 offers no stdio, but both
//  Claude Code (`--transport http`) and Codex (`url = ...`) speak
//  Streamable HTTP, and an HTTP daemon is needed anyway: campaigns
//  run for days and must outlive the client being closed.
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

/** Constant-time comparison between strings of any length. */
function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Public routes: they expose nothing about the account. */
const PUBLIC_PATHS = new Set(['/', '/healthz', '/favicon.ico']);

const LANDING_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Curtis</title>
<style>
 :root{color-scheme:light dark}
 body{font:15px/1.6 system-ui,-apple-system,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.5rem}
 code{background:color-mix(in srgb,currentColor 12%,transparent);padding:.15em .4em;border-radius:.3em}
 .dot{display:inline-block;width:.6em;height:.6em;border-radius:50%;background:#22c55e;margin-right:.5em}
</style></head>
<body>
<h1><span class="dot"></span>Curtis</h1>
<p>The daemon is running. The MCP endpoint is <code>/mcp</code> and requires a bearer token.</p>
<p>There is no web interface: everything is driven from chat, in Claude Code or Codex.
For the configuration line run <code>curtis mcp-config</code>.</p>
</body></html>`;

export function buildMcpServer(engine: Engine): MCPServer {
  const token = getAuthToken();

  const server = new MCPServer({
    name: 'curtis',
    title: 'Curtis',
    version: VERSION,
    description:
      'Local LinkedIn automation: login, importing contact lists and gradually sending connection requests and messages, under conservative rate limits.',
    instructions: INSTRUCTIONS,
    host: appConfig.host,
    port: appConfig.port,
    legacy: 'stateless',
    // Auto-discovery of `skills/` is relative to the working directory,
    // which for a global binary is arbitrary: the operating manual travels
    // in the `instructions`, which always arrive.
    skills: false,
  });

  // --- authentication of the local endpoint ---
  // A loopback server is reachable by any process on the machine, and here
  // "reaching it" means being able to send invitations and messages in the
  // user's name. The token lives in <dataDir>/token with 0600 permissions.
  server.use(async (c, next) => {
    if (token === null) return next();
    const path = new URL(c.req.url).pathname;
    if (PUBLIC_PATHS.has(path)) return next();

    const header = c.req.header('authorization') ?? '';
    const given = header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : (c.req.header('x-curtis-token') ?? '');
    if (!given || !tokenMatches(given, token)) {
      return c.json({ error: 'unauthorized', hint: 'run `curtis mcp-config` to get the token' }, 401);
    }
    return next();
  });

  server.get('/', (c) => c.html(LANDING_PAGE));
  server.get('/healthz', (c) => c.json({ ok: true, name: 'curtis', version: VERSION }));

  registerAuthTools(server, engine);
  registerContactTools(server);
  registerCampaignTools(server);
  registerEngineTools(server, engine);
  registerSafetyTools(server);
  registerInsightTools(server);
  registerQuickstartTools(server, engine);

  return server;
}
