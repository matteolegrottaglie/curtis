// ============================================================
//  LinkedIn authentication.
//
//  LinkedIn has no public API for sending invites: "auth" here is the
//  ordinary login inside a real Chrome window driven by Playwright.
//  The tool never sees nor stores the password: it opens the page, the
//  user signs in by hand (Google and 2FA included), and the session
//  lives on in the browser profile on disk.
// ============================================================
import type { Engine, AuthStatus } from '../sequencer/engine.js';
import { sleep } from '../util/time.js';

export type LoginStatus = 'connected' | 'pending' | 'engine_running' | 'cancelled';

export interface LoginOutcome {
  status: LoginStatus;
  account: string | null;
  logged_in: boolean;
  message: string;
  waited_seconds: number;
}

/**
 * Sends the browser back to the background after login, so no window is
 * left sitting on screen. If for any reason the session did not survive
 * restarting the context, the visible window is restored: better one
 * window too many than a login thrown away.
 */
async function hideWindow(engine: Engine): Promise<boolean> {
  if (!engine.session.visible) return false;
  try {
    await engine.session.ensureMode(false);
    if (await engine.session.hasAuthCookie()) return true;
    await engine.session.ensureMode(true);
    return false;
  } catch {
    return false;
  }
}

export async function authStatus(engine: Engine): Promise<AuthStatus> {
  return engine.authStatus();
}

/**
 * Opens the login window and waits for the user to finish signing in.
 *
 * Polling uses the *passive* check (the `li_at` cookie, no navigation):
 * navigating while the user is typing their credentials would knock them
 * out of the flow.
 */
export async function login(
  engine: Engine,
  opts: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onProgress?: (elapsedSeconds: number, totalSeconds: number) => void;
  } = {},
): Promise<LoginOutcome> {
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 180_000, 10_000), 600_000);
  const totalSeconds = Math.round(timeoutMs / 1000);

  if (engine.isRunning()) {
    return {
      status: 'engine_running',
      account: null,
      logged_in: false,
      message:
        'The engine is working and owns the browser window. Stop it (engine_control action="stop") and retry the login.',
      waited_seconds: 0,
    };
  }

  const opened = await engine.openLogin();
  if (opened.loggedIn) {
    return {
      status: 'connected',
      account: opened.account,
      logged_in: true,
      message: `Already signed in as ${opened.account ?? 'LinkedIn account'}.`,
      waited_seconds: 0,
    };
  }

  const started = Date.now();
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      return {
        status: 'cancelled',
        account: null,
        logged_in: false,
        message: 'Wait interrupted. The browser stays open: finish the login and call linkedin_auth_status again.',
        waited_seconds: Math.round((Date.now() - started) / 1000),
      };
    }
    await sleep(3000);
    const st = await engine.authStatus();
    if (st.loggedIn) {
      const hidden = await hideWindow(engine);
      return {
        status: 'connected',
        account: st.account,
        logged_in: true,
        message:
          `Login completed as ${st.account ?? 'LinkedIn account'}. The session is saved: you won't have to do it again.` +
          (hidden ? ' The browser window has been closed: from here on it works in the background.' : ''),
        waited_seconds: Math.round((Date.now() - started) / 1000),
      };
    }
    opts.onProgress?.(Math.round((Date.now() - started) / 1000), totalSeconds);
  }

  return {
    status: 'pending',
    account: null,
    logged_in: false,
    message:
      'No login detected within the wait window. The browser window stays open: finish signing in, then call linkedin_auth_status again.',
    waited_seconds: totalSeconds,
  };
}

export async function logout(engine: Engine): Promise<AuthStatus> {
  return engine.logout();
}
