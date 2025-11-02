import pino from 'pino';

export function createLogger(name: string) {
  const isProd = process.env.NODE_ENV === 'production';
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    ...(isProd ? {} : {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    }),
  });
}
