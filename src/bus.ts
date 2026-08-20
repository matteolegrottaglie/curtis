// ============================================================
//  Internal event bus: the engine emits events, the dashboard (SSE)
//  listens to them for live updates.
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
