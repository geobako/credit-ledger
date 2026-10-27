import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { UsersService } from '../auth/users.service';
import { configureApp } from '../common/http/configure-app';
import { DEMO_USERS, seedDemoData } from '../database/seed';
import { signWebhook } from '../webhooks/webhook-signature';

export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-0123456789-abcdefghij';

export interface TestApp {
  app: INestApplication;
  http: TestAgent;
  /** Token for a seeded demo user (bypasses the rate-limited sign-in endpoint). */
  login: (email: (typeof DEMO_USERS)[number]['email']) => Promise<string>;
  /** Registers a brand-new customer (tests stay independent of each other). */
  newCustomer: () => Promise<string>;
  /** Delivers a payment-provider event exactly as the provider would: raw JSON + signature. */
  deliverWebhook: (event: unknown, options?: { signature?: string }) => request.Test;
  close: () => Promise<void>;
}

/** Boots the real application (all modules, guards, pipes, filters) against the test database. */
export async function createTestApp(): Promise<TestApp> {
  Object.assign(process.env, {
    WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    SANDBOX_ENABLED: 'true',
    LOG_LEVEL: 'error',
    NODE_ENV: 'test',
  });
  await seedDemoData(process.env.DATABASE_URL!);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true, bufferLogs: true });
  configureApp(app);
  await app.init();
  const http = request(app.getHttpServer() as Server);

  return {
    app,
    http,
    login: async (email) => {
      const user = await app.get(UsersService).findByEmail(email);
      return app.get(TokenService).issue({ userId: user!.id, email: user!.email, role: user!.role })
        .accessToken;
    },
    // Created directly: the public register endpoint is rate limited (and tested on its own).
    newCustomer: async () => {
      const user = await app
        .get(UsersService)
        .registerCustomer(`c-${randomUUID()}@acme.test`, 'Test Customer');
      return app.get(TokenService).issue({ userId: user.id, email: user.email, role: user.role })
        .accessToken;
    },
    deliverWebhook: (event, options = {}) => {
      const raw = JSON.stringify(event);
      return http
        .post('/v1/webhooks/payments')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', options.signature ?? signWebhook(TEST_WEBHOOK_SECRET, raw))
        .send(raw);
    },
    close: () => app.close(),
  };
}

export const idemKey = () => randomUUID();
