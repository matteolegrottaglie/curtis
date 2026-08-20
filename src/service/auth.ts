// ============================================================
//  Autenticazione LinkedIn.
//
//  LinkedIn non ha API pubbliche per inviare inviti: l'"auth" è il
//  login normale dentro una finestra di Chrome reale, controllata da
//  Playwright. Il tool NON vede né salva la password: apre la pagina,
//  l'utente accede a mano (anche con Google e 2FA), e la sessione
//  resta nel profilo browser su disco.
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
 * Riporta il browser in background dopo il login, così non resta una
 * finestra aperta sullo schermo. Se per qualunque motivo la sessione non
 * sopravvivesse al riavvio del contesto, si ripristina la finestra
 * visibile: meglio una finestra di troppo che un login perso.
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
 * Apre la finestra di login e attende che l'utente completi l'accesso.
 *
 * Il polling usa la verifica *passiva* (cookie `li_at`, nessuna navigazione):
 * navigare mentre l'utente sta digitando le credenziali lo butterebbe fuori
 * dal flusso.
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
        "L'engine sta lavorando e possiede la finestra del browser. Fermalo (engine_control action=\"stop\") e riprova il login.",
      waited_seconds: 0,
    };
  }

  const opened = await engine.openLogin();
  if (opened.loggedIn) {
    return {
      status: 'connected',
      account: opened.account,
      logged_in: true,
      message: `Già connesso come ${opened.account ?? 'account LinkedIn'}.`,
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
        message: 'Attesa interrotta. Il browser resta aperto: completa il login e richiama linkedin_auth_status.',
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
          `Login completato come ${st.account ?? 'account LinkedIn'}. La sessione resta salvata: non dovrai rifarlo.` +
          (hidden ? ' La finestra del browser è stata chiusa: da qui in poi lavora in background.' : ''),
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
      'Login non ancora rilevato entro il tempo di attesa. La finestra del browser resta aperta: completa l\'accesso e poi richiama linkedin_auth_status.',
    waited_seconds: totalSeconds,
  };
}

export async function logout(engine: Engine): Promise<AuthStatus> {
  return engine.logout();
}
