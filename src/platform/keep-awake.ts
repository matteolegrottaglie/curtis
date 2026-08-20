// ============================================================
//  Impedisce al Mac di addormentarsi mentre il motore lavora.
//
//  Senza questo, su macOS il sistema va in sleep dopo pochi minuti di
//  inattività dell'utente e l'automazione resta congelata a metà
//  sequenza. Nel progetto originale il trucco stava nello script del
//  LaunchAgent (`caffeinate -si npm start`); qui vive nel daemon, così
//  tiene sveglia la macchina SOLO nei minuti in cui il motore lavora
//  davvero, non per tutta la giornata.
// ============================================================
import { spawn, type ChildProcess } from 'node:child_process';
import { log } from '../util/log.js';

export class KeepAwake {
  #proc: ChildProcess | null = null;

  get active(): boolean {
    return this.#proc !== null;
  }

  start(): void {
    if (this.#proc || process.platform !== 'darwin') return;
    try {
      // -s: niente system sleep (efficace a corrente) · -i: niente idle sleep
      this.#proc = spawn('/usr/bin/caffeinate', ['-si'], { stdio: 'ignore', detached: false });
      this.#proc.on('exit', () => {
        this.#proc = null;
      });
      log.debug('caffeinate attivo: il Mac resta sveglio mentre il motore lavora');
    } catch (e) {
      log.warn({ err: String(e) }, 'caffeinate non disponibile: il Mac potrebbe addormentarsi a metà sequenza');
      this.#proc = null;
    }
  }

  stop(): void {
    if (!this.#proc) return;
    this.#proc.kill('SIGTERM');
    this.#proc = null;
  }
}
