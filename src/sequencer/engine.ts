// ============================================================
//  Engine: il worker loop che orchestra tutto.
//
//  Ad ogni "tick":
//   1. ricalcola i limiti del giorno (controller adattivo)
//   2. rispetta halt / pausa / finestra oraria / login
//   3. avanza gli step "wait" (istantanei)
//   4. esegue UNA azione browser permessa, poi pausa umana
//   5. ogni N azioni, pausa lunga
//
//  È volutamente lento: una azione alla volta, con ritardi
//  randomici. La lentezza È la sicurezza.
// ============================================================
import * as repo from '../db/repo.js';
import * as controller from '../safety/controller.js';
import * as actions from '../linkedin/actions.js';
import { LinkedInSession } from '../browser/session.js';
import { renderTemplate } from './template.js';
import { humanPause, longBreak, nextBreakThreshold } from '../browser/human.js';
import { inWorkingWindow, nextWindowOpen, sleep, isoDate } from '../util/time.js';
import { randInt } from '../util/rand.js';
import { emitEvent } from '../bus.js';
import { log } from '../util/log.js';
import type { ActionKind, ActionResult, CampaignOverrides, SafetyConfig, Step } from '../types.js';
import type { DueEnrollment } from '../db/repo.js';

const H = 3600_000;
const MIN = 60_000;

function kindForStep(step: Step): ActionKind | null {
  switch (step.type) {
    case 'visit':
      return 'visit';
    case 'connect':
      return 'connect';
    case 'message':
      return 'message';
    case 'follow':
      return 'follow';
    case 'like_recent':
      return 'like';
    case 'wait_accept':
      return 'check_accepted';
    case 'wait':
      return null; // gestito a parte (istantaneo)
  }
}

export interface AuthStatus {
  launched: boolean;
  loggedIn: boolean;
  busy: boolean;
  account: string | null;
  avatar: string | null;
}

/** Estrae gli override per-campagna dal campo settings JSON; tollerante a JSON malformato. */
function parseCampaignOverrides(settingsJson: string | null): CampaignOverrides {
  if (!settingsJson) return {};
  try {
    return JSON.parse(settingsJson) as CampaignOverrides;
  } catch {
    return {};
  }
}

/** Sovrappone i campi per-campagna onorati dall'engine sopra alla SafetyConfig globale. */
function effectiveConfig(global: SafetyConfig, ov: CampaignOverrides): SafetyConfig {
  const out: SafetyConfig = { ...global };
  if (ov.delays) out.delays = { ...global.delays, ...ov.delays };
  if (ov.caps) out.caps = { ...global.caps, ...ov.caps };
  if (ov.sendNoteOnConnect !== undefined) out.sendNoteOnConnect = ov.sendNoteOnConnect;
  if (ov.workingDays) out.workingDays = ov.workingDays;
  if (ov.workStartHour !== undefined) out.workStartHour = ov.workStartHour;
  if (ov.workEndHour !== undefined) out.workEndHour = ov.workEndHour;
  if (ov.timezone) out.timezone = ov.timezone;
  return out;
}

export class Engine {
  readonly session = new LinkedInSession();
  private running = false;
  private stopRequested = false;
  private loopHandle: Promise<void> | null = null;
  private actionsSinceBreak = 0;
  private breakThreshold = 8;
  private lastNote = '';
  private lastLoggedIn = false;
  private account: string | null = null;
  private avatar: string | null = null;

  isRunning(): boolean {
    return this.running;
  }

  status() {
    const s = repo.getControllerState();
    const cfg = repo.getSafetyConfig();
    return {
      running: this.running,
      paused: s.paused,
      halted: !!s.haltedReason,
      haltedReason: s.haltedReason,
      backoffUntil: s.backoffUntil,
      dailyTarget: s.currentDailyTarget,
      weeklyCeiling: s.currentWeeklyCeiling,
      invitesToday: repo.countActions({
        type: 'connect',
        status: 'success',
        since: startOfDay(cfg.timezone),
      }),
      invitesThisWeek: repo.invitesInWindow(7),
      pending: repo.pendingInvitesCount(),
      acceptance: repo.acceptanceRate(30),
      inWindow: inWorkingWindow(cfg),
      note: this.lastNote,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;

    const cfg = repo.getSafetyConfig();
    if (!cfg.warmupStartDate) {
      cfg.warmupStartDate = isoDate(cfg.timezone);
      repo.saveSafetyConfig(cfg);
      log.info({ start: cfg.warmupStartDate }, 'warm-up iniziato oggi');
    }
    // riprende da eventuale pausa
    const st = repo.getControllerState();
    st.paused = false;
    repo.saveControllerState(st);

    this.breakThreshold = nextBreakThreshold(cfg);
    // Se il login aveva aperto la finestra, qui si torna in background:
    // durante il lavoro non deve comparire nulla sullo schermo dell'utente.
    await this.session.launch();
    emitEvent('status', this.status());
    this.loopHandle = this.loop();
    log.info('engine avviato');
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    this.running = false;
    await this.loopHandle?.catch(() => {});
    await this.session.close();
    emitEvent('status', this.status());
    log.info('engine fermato');
  }

  pause(): void {
    controller.pause();
    emitEvent('status', this.status());
  }
  resume(): void {
    controller.resume();
    emitEvent('status', this.status());
  }

  // ---- Autenticazione (gestita dal tab "Account") ----
  async authStatus(): Promise<AuthStatus> {
    if (!this.session.context) return { launched: false, loggedIn: false, busy: false, account: null, avatar: null };
    if (this.running) return { launched: true, loggedIn: this.lastLoggedIn, busy: true, account: this.account, avatar: this.avatar };
    const loggedIn = await this.session.isLoggedInPassive();
    this.lastLoggedIn = loggedIn;
    if (loggedIn) {
      this.account = await this.session.getAccountName();
      this.avatar = await this.session.getAvatarUrl();
    } else {
      this.account = null;
      this.avatar = null;
    }
    return { launched: true, loggedIn, busy: false, account: this.account, avatar: this.avatar };
  }

  async openLogin(): Promise<AuthStatus & { error?: string }> {
    if (this.running) {
      return {
        launched: !!this.session.context,
        loggedIn: this.lastLoggedIn,
        busy: true,
        account: this.account,
        avatar: this.avatar,
        error: 'engine_running',
      };
    }
    await this.session.launch({ visible: true });
    await this.session.gotoLogin();
    return this.authStatus();
  }

  async logout(): Promise<AuthStatus> {
    if (this.running) throw new Error("Ferma l'engine prima di disconnetterti");
    await this.session.launch();
    await this.session.clearSession();
    this.lastLoggedIn = false;
    this.account = null;
    return this.authStatus();
  }

  /** All'avvio del tool: riusa la sessione salvata, così risulti "Connesso" senza login. */
  async connectSavedSession(): Promise<void> {
    if (this.running || this.session.context) return;
    try {
      await this.session.launch();
      const ok = await this.session.isLoggedInPassive();
      this.lastLoggedIn = ok;
      if (ok) {
        await this.session.page
          ?.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' })
          .catch(() => {});
        this.account = await this.session.getAccountName();
        this.avatar = await this.session.getAvatarUrl();
        log.info({ account: this.account ?? '?' }, 'sessione LinkedIn riconnessa automaticamente');
      } else {
        await this.session.gotoLogin();
        log.warn('nessuna sessione salvata valida: apri il tab "Account" e accedi una volta');
      }
    } catch (e) {
      log.error({ err: String(e) }, 'auto-connect non riuscito (connettiti dal tab Account)');
    }
    emitEvent('status', this.status());
  }

  private async loop(): Promise<void> {
    while (!this.stopRequested) {
      try {
        await this.tick();
      } catch (e) {
        log.error({ err: String(e) }, 'errore nel tick');
        await sleep(15_000);
      }
    }
  }

  private setNote(n: string): void {
    this.lastNote = n;
    emitEvent('status', this.status());
  }

  private async tick(): Promise<void> {
    const cfg = repo.getSafetyConfig();
    controller.recomputeDaily();
    const state = repo.getControllerState();

    if (state.haltedReason) {
      this.setNote(`HALT: ${state.haltedReason} — intervieni e premi "Riprendi sicurezza"`);
      await sleep(60_000);
      return;
    }
    if (state.paused) {
      this.setNote('in pausa');
      await sleep(15_000);
      return;
    }
    if (!inWorkingWindow(cfg)) {
      const next = nextWindowOpen(cfg);
      this.setNote(`fuori orario lavorativo, riprendo intorno alle ${new Date(next).toLocaleString('it-IT')}`);
      await sleep(Math.min(10 * MIN, Math.max(30_000, next - Date.now())));
      return;
    }

    // login
    const logged = await this.session.isLoggedIn();
    this.lastLoggedIn = logged;
    if (!logged) {
      this.setNote('login richiesto: vai al tab "Account" e accedi con Google nella finestra del browser');
      await this.session.page
        ?.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' })
        .catch(() => {});
      await sleep(20_000);
      return;
    }

    // pausa lunga periodica
    if (this.actionsSinceBreak >= this.breakThreshold) {
      this.setNote('pausa lunga (caffè)');
      log.info('pausa lunga');
      await longBreak(cfg);
      this.actionsSinceBreak = 0;
      this.breakThreshold = nextBreakThreshold(cfg);
    }

    // scegli ed esegui
    const picked = this.pickBrowserAction();
    if (!picked) {
      this.setNote('niente di pronto: attendo nuova attività / finestra limiti');
      await sleep(randInt(30_000, 90_000));
      return;
    }

    await this.execute(picked.item, picked.step, picked.kind);
    this.actionsSinceBreak++;
    // Delay per-campagna se l'override è presente, altrimenti delays globali.
    await humanPause(effectiveConfig(cfg, picked.overrides));
  }

  /** Avanza gli step 'wait' (istantanei) e ritorna la prima azione browser permessa. */
  private pickBrowserAction(): {
    item: DueEnrollment;
    step: Step;
    kind: ActionKind;
    overrides: CampaignOverrides;
  } | null {
    const due = repo.getDueEnrollments(60);
    for (const it of due) {
      const steps = JSON.parse(it.campaign.steps) as Step[];
      const idx = it.enrollment.current_step;
      const step = steps[idx];
      if (!step) {
        repo.updateEnrollment(it.enrollment.id, { status: 'completed', next_action_at: null });
        continue;
      }
      if (step.type === 'wait') {
        this.applyWait(it, step, steps);
        continue;
      }
      const kind = kindForStep(step);
      if (!kind) continue;
      const overrides = parseCampaignOverrides(it.campaign.settings);
      // Finestra oraria per-campagna: restrizione aggiuntiva alla globale (la globale è già
      // stata verificata in tick(); qui salto le campagne con una finestra propria chiusa adesso).
      const hasOwnWindow =
        overrides.workingDays ||
        overrides.workStartHour !== undefined ||
        overrides.workEndHour !== undefined ||
        overrides.timezone;
      if (hasOwnWindow && !inWorkingWindow(effectiveConfig(repo.getSafetyConfig(), overrides))) continue;
      // Se la campagna ha un cap specifico per questo kind, lo passo al controller.
      const capKey = controller.capKeyFor(kind);
      const perCampaignCap = capKey ? overrides.caps?.[capKey] : undefined;
      const perCampaign =
        perCampaignCap !== undefined ? { campaignId: it.campaign.id, cap: perCampaignCap } : undefined;
      if (controller.actionAllowedNow(kind, Date.now(), perCampaign).ok) {
        return { item: it, step, kind, overrides };
      }
    }
    return null;
  }

  private applyWait(it: DueEnrollment, step: Extract<Step, { type: 'wait' }>, steps: Step[]): void {
    const ms = (step.days ?? 0) * 24 * H + (step.hours ?? 0) * H;
    const jittered = Math.round(ms * (0.9 + Math.random() * 0.2)); // ±10%
    this.advance(it, steps, it.enrollment.current_step + 1, jittered, { status: 'in_progress' });
  }

  /** Imposta lo step successivo e schedula quando sarà "due". */
  private advance(
    it: DueEnrollment,
    steps: Step[],
    nextIndex: number,
    explicitDelay: number | null,
    extra: Partial<import('../types.js').CampaignContact> = {},
  ): void {
    if (nextIndex >= steps.length) {
      repo.updateEnrollment(it.enrollment.id, {
        status: 'completed',
        current_step: nextIndex,
        next_action_at: null,
        last_action_at: Date.now(),
        ...extra,
      });
      return;
    }
    const next = steps[nextIndex]!;
    let delay = explicitDelay;
    if (delay === null) {
      switch (next.type) {
        case 'wait_accept':
          delay = randInt(18, 30) * H;
          break;
        case 'wait':
          delay = 0; // verrà applicato al prossimo tick
          break;
        default:
          delay = randInt(15, 90) * MIN; // spaziatura intra-sequenza
      }
    }
    repo.updateEnrollment(it.enrollment.id, {
      current_step: nextIndex,
      next_action_at: Date.now() + delay,
      last_action_at: Date.now(),
      status: 'in_progress',
      ...extra,
    });
  }

  private async execute(item: DueEnrollment, step: Step, kind: ActionKind): Promise<void> {
    const cfg = repo.getSafetyConfig();
    const { enrollment: e, contact, campaign } = item;
    const steps = JSON.parse(campaign.steps) as Step[];
    let res: ActionResult;

    this.setNote(`${kind} → ${contact.full_name ?? contact.profile_url}`);

    try {
      switch (step.type) {
        case 'visit':
          res = await actions.visitProfile(this.session, contact);
          break;
        case 'connect': {
          const overrides = campaign.settings ? (JSON.parse(campaign.settings) as { sendNoteOnConnect?: boolean }) : {};
          const sendNote = !!step.note && (overrides.sendNoteOnConnect ?? cfg.sendNoteOnConnect);
          const note = step.note ? renderTemplate(step.note, contact) : undefined;
          res = await actions.sendConnectionRequest(this.session, contact, { note, sendNote });
          break;
        }
        case 'message':
          res = await actions.sendMessage(this.session, contact, renderTemplate(step.text, contact));
          break;
        case 'follow':
          res = await actions.followProfile(this.session, contact);
          break;
        case 'like_recent':
          res = await actions.likeRecentPost(this.session, contact);
          break;
        case 'wait_accept':
          res = await actions.checkAccepted(this.session, contact);
          break;
        default:
          res = { status: 'skipped', detail: 'step non gestito' };
      }
    } catch (err) {
      res = { status: 'failed', detail: `eccezione: ${String(err)}` };
    }

    repo.logAction({
      campaign_id: campaign.id,
      contact_id: contact.id,
      type: kind,
      status: res.status,
      detail: res.detail ?? null,
      screenshot: res.screenshot ?? null,
    });
    emitEvent('action', {
      type: kind,
      status: res.status,
      detail: res.detail,
      contact: contact.full_name ?? contact.profile_url,
      url: contact.profile_url,
      campaign: campaign.name,
    });

    // segnale di LinkedIn -> controller
    if (res.status === 'blocked' && res.signal) {
      controller.onSignal(res.signal.kind, res.signal.severity, res.signal.detail);
      emitEvent('signal', res.signal);
      // non avanzare: riprova più tardi
      repo.updateEnrollment(e.id, { next_action_at: Date.now() + 1 * H });
      return;
    }

    // gestione per tipo di step
    await this.handleResult(item, step, steps, res);
  }

  private async handleResult(item: DueEnrollment, step: Step, steps: Step[], res: ActionResult): Promise<void> {
    const e = item.enrollment;
    const idx = e.current_step;

    const retryOrFail = () => {
      const attempts = (e.attempts ?? 0) + 1;
      if (attempts >= 3) {
        repo.updateEnrollment(e.id, { status: 'failed', attempts, last_error: res.detail ?? 'errore', next_action_at: null });
      } else {
        repo.updateEnrollment(e.id, { attempts, last_error: res.detail ?? null, next_action_at: Date.now() + randInt(2, 6) * H });
      }
    };

    switch (step.type) {
      case 'connect': {
        if (res.status === 'success' || res.status === 'skipped') {
          // skipped = invito già pendente: trattalo come inviato
          this.advance(item, steps, idx + 1, null, {
            status: 'connect_sent',
            connect_sent_at: e.connect_sent_at ?? Date.now(),
          });
        } else retryOrFail();
        break;
      }
      case 'wait_accept': {
        const detail = res.detail ?? 'unknown';
        const sentAt = e.connect_sent_at ?? e.created_at;
        const maxMs = (step.maxDays ?? 14) * 24 * H;
        const expired = Date.now() - sentAt > maxMs;
        if (detail === 'accepted') {
          this.advance(item, steps, idx + 1, null, { status: 'accepted', accepted_at: Date.now() });
        } else if (expired) {
          // scaduto: prova a ritirare l'invito (igiene backlog) e chiudi
          await this.maybeWithdraw(item);
          repo.updateEnrollment(e.id, { status: 'not_accepted', next_action_at: null, last_action_at: Date.now() });
        } else {
          // ancora in attesa: ricontrolla domani
          repo.updateEnrollment(e.id, { next_action_at: Date.now() + randInt(20, 28) * H, last_action_at: Date.now() });
        }
        break;
      }
      case 'message':
        if (res.status === 'success') this.advance(item, steps, idx + 1, null);
        else retryOrFail();
        break;
      case 'visit':
      case 'follow':
      case 'like_recent':
        // azioni "soft": anche se skipped, andiamo avanti
        if (res.status === 'success' || res.status === 'skipped') this.advance(item, steps, idx + 1, null);
        else retryOrFail();
        break;
      default:
        this.advance(item, steps, idx + 1, null);
    }
  }

  /** Ritiro best-effort dell'invito scaduto (se i limiti lo permettono). Sequenziale. */
  private async maybeWithdraw(item: DueEnrollment): Promise<void> {
    if (!controller.actionAllowedNow('withdraw').ok) return;
    const r = await actions.withdrawInvite(this.session, item.contact);
    repo.logAction({
      campaign_id: item.campaign.id,
      contact_id: item.contact.id,
      type: 'withdraw',
      status: r.status,
      detail: r.detail ?? null,
      screenshot: r.screenshot ?? null,
    });
    emitEvent('action', {
      type: 'withdraw',
      status: r.status,
      detail: r.detail,
      contact: item.contact.full_name ?? item.contact.profile_url,
    });
  }
}

import { DateTime } from 'luxon';
function startOfDay(tz: string): number {
  return DateTime.now().setZone(tz).startOf('day').toMillis();
}
