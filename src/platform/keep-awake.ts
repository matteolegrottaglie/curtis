// ============================================================
//  Keeps the Mac from falling asleep while the engine is working.
//
//  Without this, macOS goes to sleep after a few minutes of user
//  inactivity and the automation is left frozen halfway through a
//  sequence. In the original project the trick lived in the LaunchAgent
//  script (`caffeinate -si npm start`); here it lives in the daemon, so
//  it keeps the machine awake ONLY during the minutes the engine is
//  actually working, not all day long.
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
      // -s: no system sleep (effective on AC power) · -i: no idle sleep
      this.#proc = spawn('/usr/bin/caffeinate', ['-si'], { stdio: 'ignore', detached: false });
      this.#proc.on('exit', () => {
        this.#proc = null;
      });
      log.debug('caffeinate active: the Mac stays awake while the engine works');
    } catch (e) {
      log.warn({ err: String(e) }, 'caffeinate unavailable: the Mac may fall asleep mid-sequence');
      this.#proc = null;
    }
  }

  stop(): void {
    if (!this.#proc) return;
    this.#proc.kill('SIGTERM');
    this.#proc = null;
  }
}
