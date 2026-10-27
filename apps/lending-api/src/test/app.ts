import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { UsersService } from '../auth/users.service';
import { configureApp } from '../common/http/configure-app';
import { DEMO_USERS, seedDemoData } from '../database/seed';
import { eq } from 'drizzle-orm';
import { signRequest } from '../common/security/request-signature';
import type { Database } from '../database/database';
import { DB } from '../database/database.module';
import { cards } from '../database/schema';
import { signWebhook } from '../webhooks/webhook-signature';

export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-0123456789-abcdefghij';
export const TEST_GATEWAY_SECRET = 'test-gateway-secret-0123456789-abcdefghij';

export interface ActiveAccount {
  token: string;
  accountId: string;
  cardId: string;
  cardToken: string;
}

export interface TestApp {
  app: INestApplication;
  http: TestAgent;
  /** Token for a seeded demo user (bypasses the rate-limited sign-in endpoint). */
  login: (email: (typeof DEMO_USERS)[number]['email']) => Promise<string>;
  /** Registers a brand-new customer (tests stay independent of each other). */
  newCustomer: () => Promise<string>;
  /** Delivers a payment-provider event exactly as the provider would: raw JSON + signature. */
  deliverWebhook: (event: unknown, options?: { signature?: string }) => request.Test;
  /** Calls the internal network API exactly as the card gateway would (HMAC-signed). */
  network: (path: string, body?: unknown) => request.Test;
  /** A customer with an ACTIVE account whose limit equals the given collateral. */
  activeAccount: (collateralMinor: string) => Promise<ActiveAccount>;
  db: Database;
  close: () => Promise<void>;
}

/** Boots the real application (all modules, guards, pipes, filters) against the test database. */
export async function createTestApp(): Promise<TestApp> {
  Object.assign(process.env, {
    WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    GATEWAY_SHARED_SECRET: TEST_GATEWAY_SECRET,
    AUTH_EXPIRY_SWEEP_SECONDS: '0',
    SANDBOX_ENABLED: 'true',
    LOG_LEVEL: 'error',
    NODE_ENV: 'test',
  });
  await seedDemoData(process.env.DATABASE_URL!);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true, bufferLogs: true });
  configureApp(app);
  // Listen once on an ephemeral port; supertest would otherwise re-bind per request.
  await app.listen(0, '127.0.0.1');
  const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
  const http = request(`http://127.0.0.1:${port}`);

  const db = app.get<Database>(DB);
  const deliverWebhook = (event: unknown, options: { signature?: string } = {}) => {
    const raw = JSON.stringify(event);
    return http
      .post('/v1/webhooks/payments')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', options.signature ?? signWebhook(TEST_WEBHOOK_SECRET, raw))
      .send(raw);
  };
  const newCustomer = async () => {
    const user = await app
      .get(UsersService)
      .registerCustomer(`c-${randomUUID()}@acme.test`, 'Test Customer');
    return app.get(TokenService).issue({ userId: user.id, email: user.email, role: user.role })
      .accessToken;
  };

  return {
    app,
    http,
    db,
    network: (path, body) => {
      const fullPath = `/v1/network${path}`;
      const raw = body === undefined ? '' : JSON.stringify(body);
      const req = http
        .post(fullPath)
        .set('X-Service-Id', 'card-gateway')
        .set('X-Signature', signRequest(TEST_GATEWAY_SECRET, 'POST', fullPath, raw));
      return body === undefined ? req : req.set('Content-Type', 'application/json').send(raw);
    },
    activeAccount: async (collateralMinor) => {
      const token = await newCustomer();
      const authz = { Authorization: `Bearer ${token}` };
      const account = await http
        .post('/v1/credit-accounts')
        .set(authz)
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      const accountId = (account.body as { id: string }).id;
      const deposit = await http
        .post(`/v1/credit-accounts/${accountId}/collateral-deposits`)
        .set(authz)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: collateralMinor })
        .expect(201);
      const reference = (deposit.body as { paymentInstructions: { reference: string } })
        .paymentInstructions.reference;
      await deliverWebhook({
        id: `evt_${randomUUID()}`,
        type: 'payment.succeeded',
        data: { reference, amount: collateralMinor, currency: 'USD' },
      }).expect(200);
      const [card] = await db.select().from(cards).where(eq(cards.creditAccountId, accountId));
      return { token, accountId, cardId: card!.id, cardToken: card!.networkToken };
    },
    login: async (email) => {
      const user = await app.get(UsersService).findByEmail(email);
      return app.get(TokenService).issue({ userId: user!.id, email: user!.email, role: user!.role })
        .accessToken;
    },
    // Created directly: the public register endpoint is rate limited (and tested on its own).
    newCustomer,
    deliverWebhook,
    close: () => app.close(),
  };
}

export const idemKey = () => randomUUID();
