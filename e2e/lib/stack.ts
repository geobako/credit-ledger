/**
 * Clients for the running stack. Every party talks to it the way it would in production:
 * customers and ops with JWTs, the card network through the Go gateway, the payment provider
 * with signed webhooks. Defaults match docker-compose.yml.
 */
import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';

export const config = {
  api: process.env.API_URL ?? 'http://localhost:3000',
  gateway: process.env.GATEWAY_URL ?? 'http://localhost:8081',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://acme:acme@localhost:5433/acme_credit',
  webhookSecret: process.env.WEBHOOK_SECRET ?? 'local-dev-webhook-secret-change-me-0123456789',
  gatewaySecret:
    process.env.GATEWAY_SHARED_SECRET ?? 'local-dev-gateway-secret-change-me-0123456789',
  networkKey: process.env.NETWORK_API_KEY ?? 'local-dev-network-key-change-me',
};

export interface Money {
  amount: string;
  currency: string;
}
export const usd = (minor: number | bigint): Money => ({ amount: String(minor), currency: 'USD' });

export interface Response<T> {
  status: number;
  body: T;
  headers: Headers;
}

export async function http<T = any>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; raw?: string } = {},
): Promise<Response<T>> {
  const raw = init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  const res = await fetch(url, {
    method: init.method ?? (raw === undefined ? 'GET' : 'POST'),
    headers: { ...(raw !== undefined && { 'content-type': 'application/json' }), ...init.headers },
    body: raw,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : undefined) as T,
    headers: res.headers,
  };
}

/* ───────────── people ───────────── */

export class Actor {
  readonly token: string;
  readonly user: { id: string; email: string; role: string };

  constructor(token: string, user: { id: string; email: string; role: string }) {
    this.token = token;
    this.user = user;
  }

  request<T = any>(
    path: string,
    init: { method?: string; body?: unknown; key?: string; headers?: Record<string, string> } = {},
  ) {
    return http<T>(`${config.api}${path}`, {
      method: init.method,
      body: init.body,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(init.key && { 'idempotency-key': init.key }),
        ...init.headers,
      },
    });
  }

  get<T = any>(path: string) {
    return this.request<T>(path);
  }

  /** Money-moving POST: always carries an Idempotency-Key (fresh unless given). */
  post<T = any>(path: string, body?: unknown, key: string = randomUUID()) {
    return this.request<T>(path, { method: 'POST', body: body ?? {}, key });
  }
}

export async function newCustomer(label = 'e2e'): Promise<Actor> {
  const email = `${label}-${randomUUID().slice(0, 8)}@e2e.test`;
  const res = await http(`${config.api}/v1/auth/register`, {
    body: { email, name: `E2E ${label}` },
  });
  expect(res, 201);
  return new Actor(res.body.accessToken, res.body.user);
}

export async function ops(): Promise<Actor> {
  const res = await http(`${config.api}/v1/auth/demo-login`, { body: { email: 'ops@acme.test' } });
  expect(res, 200);
  return new Actor(res.body.accessToken, res.body.user);
}

/* ───────────── payment provider ───────────── */

/** Delivers a payment event exactly as the provider would: raw JSON + Stripe-style signature. */
export function deliverPaymentEvent(
  event: {
    id?: string;
    type: 'payment.succeeded' | 'payment.failed';
    reference: string;
    amount: string;
    failureReason?: string;
  },
  { secret = config.webhookSecret, timestamp = Math.floor(Date.now() / 1000) } = {},
) {
  const raw = JSON.stringify({
    id: event.id ?? `evt_${randomUUID().replace(/-/g, '')}`,
    type: event.type,
    data: {
      reference: event.reference,
      amount: event.amount,
      currency: 'USD',
      ...(event.failureReason && { failure_reason: event.failureReason }),
    },
  });
  const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex');
  return http(`${config.api}/v1/webhooks/payments`, {
    raw,
    headers: { 'x-webhook-signature': `t=${timestamp},v1=${signature}` },
  });
}

/* ───────────── card network (through the Go gateway) ───────────── */

export interface NetworkResponse {
  network_transaction_id: string;
  approved: boolean;
  response_code: string;
  authorization_id: string | null;
  reason?: string;
}

export function authorize(
  cardToken: string,
  amount: number,
  opts: { txId?: string; merchant?: string; key?: string } = {},
) {
  return http<NetworkResponse>(`${config.gateway}/v1/authorizations`, {
    headers: { 'x-network-key': opts.key ?? config.networkKey },
    body: {
      network_transaction_id: opts.txId ?? `e2e_${randomUUID()}`,
      card_token: cardToken,
      amount,
      currency: 'USD',
      merchant: { name: opts.merchant ?? 'E2E Merchant', mcc: '5812' },
    },
  });
}

export function capture(authorizationId: string, amount?: number) {
  return http(`${config.gateway}/v1/authorizations/${authorizationId}/capture`, {
    headers: { 'x-network-key': config.networkKey },
    body: amount === undefined ? {} : { amount },
  });
}

export function reverse(authorizationId: string) {
  return http(`${config.gateway}/v1/authorizations/${authorizationId}/reversal`, {
    method: 'POST',
    headers: { 'x-network-key': config.networkKey },
  });
}

/** Calls the lending API's internal network endpoint directly, signed like the gateway does. */
export function signedNetworkAuthorize(
  cardToken: string,
  amount: number,
  txId = `e2e_${randomUUID()}`,
) {
  const path = '/v1/network/authorizations';
  const raw = JSON.stringify({
    networkTransactionId: txId,
    cardToken,
    amount: String(amount),
    currency: 'USD',
    merchantName: 'E2E Burst',
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', config.gatewaySecret)
    .update(`${t}\nPOST\n${path}\n`)
    .update(raw)
    .digest('hex');
  return http(`${config.api}${path}`, {
    raw,
    headers: { 'x-service-id': 'card-gateway', 'x-signature': `t=${t},v1=${sig}` },
  });
}

/**
 * The network-side card token. Customers never see it (only last4); in reality it lives in
 * the network's token vault, so the suite reads it straight from the issuer database.
 */
export async function cardToken(cardId: string): Promise<string> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ network_token: string }>(
      'SELECT network_token FROM cards WHERE id = $1',
      [cardId],
    );
    if (!rows[0]) throw new Error(`card ${cardId} not found`);
    return rows[0].network_token;
  } finally {
    await client.end();
  }
}

/* ───────────── flows ───────────── */

export interface Account {
  id: string;
  status: string;
  collateral: Money;
  creditLimit: Money;
  outstandingBalance: Money;
  heldAmount: Money;
  availableCredit: Money;
  refundDue: Money;
  card: { id: string; status: string; last4: string };
}

export async function openAccount(customer: Actor): Promise<Account> {
  const res = await customer.post<Account>('/v1/credit-accounts');
  expect(res, 201);
  return res.body;
}

export async function getAccount(customer: Actor, id: string): Promise<Account> {
  const res = await customer.get<Account>(`/v1/credit-accounts/${id}`);
  expect(res, 200);
  return res.body;
}

/** Starts a deposit and has the provider confirm it. Returns the payment reference. */
export async function depositAndConfirm(customer: Actor, accountId: string, amount: number) {
  const res = await customer.post(`/v1/credit-accounts/${accountId}/collateral-deposits`, {
    amount: String(amount),
  });
  expect(res, 201);
  const reference: string = res.body.paymentInstructions.reference;
  const ack = await deliverPaymentEvent({
    type: 'payment.succeeded',
    reference,
    amount: String(amount),
  });
  expect(ack, 200);
  return reference;
}

export async function repayAndConfirm(customer: Actor, accountId: string, amount: number) {
  const res = await customer.post(`/v1/credit-accounts/${accountId}/repayments`, {
    amount: String(amount),
  });
  expect(res, 201);
  const reference: string = res.body.paymentInstructions.reference;
  expect(
    await deliverPaymentEvent({ type: 'payment.succeeded', reference, amount: String(amount) }),
    200,
  );
  return reference;
}

/** A customer with an active card backed by `collateral` cents. */
export async function activeCustomer(collateral: number, label?: string) {
  const customer = await newCustomer(label);
  const opened = await openAccount(customer);
  await depositAndConfirm(customer, opened.id, collateral);
  const account = await getAccount(customer, opened.id);
  return { customer, account, token: await cardToken(account.card.id) };
}

/* ───────────── assertions ───────────── */

export function expect(res: Response<unknown>, status: number): void {
  if (res.status !== status) {
    throw new Error(`expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
}

export const minor = (m: Money) => BigInt(m.amount);
