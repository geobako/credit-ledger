import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { AuthorizationsModule } from './authorizations/authorizations.module';
import { CardsModule } from './cards/cards.module';
import { ClosureModule } from './closure/closure.module';
import { CollateralModule } from './collateral/collateral.module';
import { REQUEST_ID_HEADER } from './common/context/request-context';
import { ConfigModule } from './config/config.module';
import { CreditAccountsModule } from './credit-accounts/credit-accounts.module';
import { ENV, Env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { LedgerModule } from './ledger/ledger.module';
import { MetricsModule } from './metrics/metrics.module';
import { OpsModule } from './ops/ops.module';
import { RepaymentsModule } from './repayments/repayments.module';
import { SandboxModule } from './sandbox/sandbox.module';
import { WebhooksModule } from './webhooks/webhooks.module';

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
          autoLogging: {
            ignore: (req) => ['/health', '/ready', '/metrics'].includes(req.url ?? ''),
          },
          transport:
            env.LOG_FORMAT === 'pretty'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => [{ ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE }],
    }),
    MetricsModule,
    DatabaseModule,
    EventsModule,
    LedgerModule,
    IdempotencyModule,
    AuthModule,
    HealthModule,
    CreditAccountsModule,
    CollateralModule,
    CardsModule,
    AuthorizationsModule,
    RepaymentsModule,
    ClosureModule,
    WebhooksModule,
    OpsModule,
    SandboxModule,
  ],
  // Global guards: rate limiting here, authentication in AuthModule (deny by default).
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
