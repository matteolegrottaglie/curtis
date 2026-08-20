// ============================================================
//  LinkedIn authentication tools.
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
      title: 'LinkedIn connection status',
      description:
        'Tells you whether the saved LinkedIn session is still valid and which account it belongs to. ALWAYS call this first: without a session no other action can work.',
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
        ? `Connected to LinkedIn as ${data.account ?? '(name not detected)'}.`
        : 'Not connected to LinkedIn. Use linkedin_login to sign in once.';
      return { content: [textBlock(text)], structuredContent: data };
    },
  );

  server.tool(
    {
      name: 'linkedin_login',
      title: 'Sign in to LinkedIn',
      description:
        "Opens a Chrome window on the LinkedIn login page and waits for the user to sign in by hand (Google sign-in and 2FA included). The tool never sees or stores the password: it only keeps the browser session, locally. You do this once. Warn the user that they need to watch the window that opens.",
      inputSchema: z.object({
        wait_seconds: z
          .number()
          .int()
          .min(10)
          .max(600)
          .optional()
          .describe('How long to wait for the login to complete (default 180 seconds)'),
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
            void ctx.reportProgress(elapsed, total, 'waiting for the login in the browser window…');
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
        return fromException(err, 'Login failed');
      }
    },
  );

  server.tool(
    {
      name: 'linkedin_logout',
      title: 'Disconnect LinkedIn',
      description:
        'Clears the LinkedIn session cookies from the local browser profile. A fresh linkedin_login will be needed afterwards. Requires the engine to be stopped.',
      inputSchema: z.object({}),
      outputSchema: authStatusOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async () => {
      if (engine.isRunning()) {
        return errorResult(
          'The engine is working. Stop it with engine_control action="stop" before disconnecting.',
        );
      }
      try {
        const st = await authService.logout(engine);
        return {
          content: [textBlock('LinkedIn session cleared from the local browser profile.')],
          structuredContent: {
            logged_in: st.loggedIn,
            account: st.account,
            browser_launched: st.launched,
            engine_busy: st.busy,
          },
        };
      } catch (err) {
        return fromException(err, 'Logout failed');
      }
    },
  );
}
