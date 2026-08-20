// ============================================================
//  Logger (pino) with human-readable console output.
// ============================================================
import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

export const log = pino({
  level,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: process.stdout.isTTY === true,
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});

export type Logger = typeof log;
