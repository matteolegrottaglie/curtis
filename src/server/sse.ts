// ============================================================
//  Server-Sent Events: stream live degli eventi dell'engine
//  verso la dashboard (azioni, segnali, stato).
// ============================================================
import type { FastifyInstance } from 'fastify';
import { bus, type AppEvent } from '../bus.js';

export function registerSse(app: FastifyInstance): void {
  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': connected\n\n');

    const onEvent = (ev: AppEvent) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      } catch {
        /* socket chiuso */
      }
    };
    bus.on('event', onEvent);

    const ping = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }, 25_000);

    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('event', onEvent);
    });
  });
}
