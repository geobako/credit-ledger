import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { ENV, Env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { LedgerModule } from './ledger/ledger.module';

export const REQUEST_ID_HEADER = 'x-request-id';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          // Correlation id: honour the caller's (e.g. the card gateway) or mint one.
          genReqId: (req, res) => {
            const incoming = req.headers[REQUEST_ID_HEADER];
            const id =
              typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
            res.setHeader(REQUEST_ID_HEADER, id);
            return id;
          },
          // Never log credentials or signatures.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-signature"]',
              'req.headers["x-webhook-signature"]',
            ],
            censor: '[REDACTED]',
          },
          autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    DatabaseModule,
    LedgerModule,
    IdempotencyModule,
    HealthModule,
  ],
})
export class AppModule {}
