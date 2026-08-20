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
      const proc = spawn('/usr/bin/caffeinate', ['-si'], { stdio: 'ignore', detached: false });
      this.#proc = proc;
      // Without an 'error' listener a failed spawn (binary missing, no
      // permission) is emitted as an unhandled 'error' event, which takes the
      // whole daemon down. Staying awake is a nicety; the daemon is not.
      // Both handlers clear the field only if it still holds *this* child: a
      // late event from a previous caffeinate must not orphan the current one.
      proc.on('error', (err) => {
        log.warn({ err: String(err) }, 'caffeinate failed to start: the Mac may fall asleep mid-sequence');
        if (this.#proc === proc) this.#proc = null;
      });
      proc.on('exit', () => {
        if (this.#proc === proc) this.#proc = null;
      });
      log.debug('caffeinate active: the Mac stays awake while the engine works');
    } catch (e) {
      log.warn({ err: String(e) }, 'caffeinate unavailable: the Mac may fall asleep mid-sequence');
      this.#proc = null;
    }
  }

  stop(): void {
    const proc = this.#proc;
    this.#proc = null;
    if (!proc) return;
    // A spawn that failed still hands back a ChildProcess, and its 'error'
    // event only lands on the next tick — so between start() and that tick
    // #proc can hold a child with no pid. ChildProcess.kill() on it reaches
    // libuv with pid 0, which is kill(0, SIGTERM): the signal goes to the
    // WHOLE process group, i.e. the daemon terminates itself. Verified.
    if (typeof proc.pid !== 'number' || proc.pid <= 0) return;
    try {
      proc.kill('SIGTERM');
    } catch (e) {
      log.warn({ err: String(e) }, 'could not stop caffeinate');
    }
  }
}
