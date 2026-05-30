// ============================================================
//  Event bus interno: l'engine emette eventi, la dashboard (SSE)
//  li ascolta per gli aggiornamenti live.
// ============================================================
import { EventEmitter } from 'node:events';

export type AppEventType = 'action' | 'signal' | 'status' | 'log';

export interface AppEvent {
  type: AppEventType;
  data: unknown;
  ts: number;
}

class Bus extends EventEmitter {}
export const bus = new Bus();
bus.setMaxListeners(50);

export function emitEvent(type: AppEventType, data: unknown): void {
  bus.emit('event', { type, data, ts: Date.now() } satisfies AppEvent);
}
