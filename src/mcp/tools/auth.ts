// ============================================================
//  Tool di autenticazione LinkedIn.
// ============================================================
import { z } from 'zod';
import type { MCPServer } from 'mcp-use';
import type { Engine } from '../../sequencer/engine.js';
import * as authService from '../../service/auth.js';
import { errorResult, fromException, textBlock } from '../result.js';

const authStatusOutput = z.object({
  logged_in: z.boolean(),
  account: z.string().nullable(),
  browser_launched: z.boolean(),
  engine_busy: z.boolean(),
});

export function registerAuthTools(server: MCPServer, engine: Engine): void {
  server.tool(
    {
      name: 'linkedin_auth_status',
      title: 'Stato connessione LinkedIn',
      description:
        'Dice se la sessione LinkedIn salvata è valida e con quale account. Chiamalo SEMPRE per primo: senza sessione nessuna altra azione può funzionare.',
      inputSchema: z.object({}),
      outputSchema: authStatusOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => {
      const st = await engine.authStatus();
      const data = {
        logged_in: st.loggedIn,
        account: st.account,
        browser_launched: st.launched,
        engine_busy: st.busy,
      };
      const text = data.logged_in
        ? `Connesso a LinkedIn come ${data.account ?? '(nome non rilevato)'}.`
        : 'Non connesso a LinkedIn. Usa linkedin_login per accedere una volta sola.';
      return { content: [textBlock(text)], structuredContent: data };
    },
  );

  server.tool(
    {
      name: 'linkedin_login',
      title: 'Accedi a LinkedIn',
      description:
        "Apre una finestra di Chrome sulla pagina di login di LinkedIn e attende che l'utente acceda a mano (anche con Google e 2FA). Il tool non vede né salva la password: conserva solo la sessione del browser, in locale. Si fa una volta sola. Avvisa l'utente che deve guardare la finestra che si apre.",
      inputSchema: z.object({
        wait_seconds: z
          .number()
          .int()
          .min(10)
          .max(600)
          .optional()
          .describe('Quanto attendere il completamento del login (default 180 secondi)'),
      }),
      outputSchema: z.object({
        status: z.enum(['connected', 'pending', 'engine_running', 'cancelled']),
        logged_in: z.boolean(),
        account: z.string().nullable(),
        waited_seconds: z.number(),
        message: z.string(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ wait_seconds }, ctx) => {
      try {
        const outcome = await authService.login(engine, {
          timeoutMs: (wait_seconds ?? 180) * 1000,
          signal: ctx.signal,
          onProgress: (elapsed, total) => {
            void ctx.reportProgress(elapsed, total, 'in attesa del login nella finestra del browser…');
          },
        });
        return {
          content: [textBlock(outcome.message)],
          structuredContent: {
            status: outcome.status,
            logged_in: outcome.logged_in,
            account: outcome.account,
            waited_seconds: outcome.waited_seconds,
            message: outcome.message,
          },
        };
      } catch (err) {
        return fromException(err, 'Login non riuscito');
      }
    },
  );

  server.tool(
    {
      name: 'linkedin_logout',
      title: 'Disconnetti LinkedIn',
      description:
        'Cancella i cookie di sessione LinkedIn dal profilo browser locale. Dopo servirà un nuovo linkedin_login. Richiede che l\'engine sia fermo.',
      inputSchema: z.object({}),
      outputSchema: authStatusOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async () => {
      if (engine.isRunning()) {
        return errorResult(
          'L\'engine sta lavorando. Fermalo con engine_control action="stop" prima di disconnetterti.',
        );
      }
      try {
        const st = await authService.logout(engine);
        return {
          content: [textBlock('Sessione LinkedIn cancellata dal profilo browser locale.')],
          structuredContent: {
            logged_in: st.loggedIn,
            account: st.account,
            browser_launched: st.launched,
            engine_busy: st.busy,
          },
        };
      } catch (err) {
        return fromException(err, 'Logout non riuscito');
      }
    },
  );
}
