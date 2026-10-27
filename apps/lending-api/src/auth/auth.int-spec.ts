import { createTestApp, idemKey, TestApp } from '../test/app';

describe('authentication & authorization (HTTP)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('denies by default: protected routes need a token', async () => {
    const res = await t.http.get('/v1/credit-accounts').expect(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  });

  it('rejects a garbage token', async () => {
    await t.http.get('/v1/me').set(auth('not.a.token')).expect(401);
  });

  it('keeps health checks public', async () => {
    await t.http.get('/health').expect(200);
    await t.http.get('/ready').expect(200);
  });

  it('registers a customer through the public endpoint and returns their identity', async () => {
    const email = `new-${idemKey()}@acme.test`;
    const res = await t.http
      .post('/v1/auth/register')
      .send({ email, name: 'New Customer' })
      .expect(201);
    const me = await t.http
      .get('/v1/me')
      .set(auth((res.body as { accessToken: string }).accessToken))
      .expect(200);
    expect(me.body).toMatchObject({ email, role: 'customer' });
  });

  it('rate limits sign-in attempts', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push(
        (await t.http.post('/v1/auth/demo-login').send({ email: 'nobody@acme.test' })).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('rejects a duplicate registration', async () => {
    await t.http
      .post('/v1/auth/register')
      .send({ email: 'alice@acme.test', name: 'Again' })
      .expect(409);
  });

  it('allows one open credit account per customer', async () => {
    const token = await t.newCustomer();
    await t.http
      .post('/v1/credit-accounts')
      .set(auth(token))
      .set('Idempotency-Key', idemKey())
      .expect(201);
    const second = await t.http
      .post('/v1/credit-accounts')
      .set(auth(token))
      .set('Idempotency-Key', idemKey())
      .expect(409);
    expect(second.body).toMatchObject({ code: 'CREDIT_ACCOUNT_ALREADY_OPEN' });
  });

  it("hides other customers' accounts as not found", async () => {
    const owner = await t.newCustomer();
    const stranger = await t.newCustomer();
    const account = await t.http
      .post('/v1/credit-accounts')
      .set(auth(owner))
      .set('Idempotency-Key', idemKey())
      .expect(201);
    const id = (account.body as { id: string }).id;

    await t.http.get(`/v1/credit-accounts/${id}`).set(auth(stranger)).expect(404);
    await t.http
      .post(`/v1/credit-accounts/${id}/collateral-deposits`)
      .set(auth(stranger))
      .set('Idempotency-Key', idemKey())
      .send({ amount: '50000' })
      .expect(404);
    const list = await t.http.get('/v1/credit-accounts').set(auth(stranger)).expect(200);
    expect(list.body).toEqual([]);
  });

  it('lets operations staff see any account but not open one', async () => {
    const owner = await t.newCustomer();
    const ops = await t.login('ops@acme.test');
    const account = await t.http
      .post('/v1/credit-accounts')
      .set(auth(owner))
      .set('Idempotency-Key', idemKey())
      .expect(201);
    const id = (account.body as { id: string }).id;

    await t.http.get(`/v1/credit-accounts/${id}`).set(auth(ops)).expect(200);
    await t.http
      .post('/v1/credit-accounts')
      .set(auth(ops))
      .set('Idempotency-Key', idemKey())
      .expect(403);
  });

  it('rejects malformed ids and unknown fields', async () => {
    const token = await t.newCustomer();
    await t.http.get('/v1/credit-accounts/not-a-uuid').set(auth(token)).expect(400);
    const account = await t.http
      .post('/v1/credit-accounts')
      .set(auth(token))
      .set('Idempotency-Key', idemKey())
      .expect(201);
    await t.http
      .post(`/v1/credit-accounts/${(account.body as { id: string }).id}/collateral-deposits`)
      .set(auth(token))
      .set('Idempotency-Key', idemKey())
      .send({ amount: '50000', creditLimit: '99999999' })
      .expect(400);
  });
});
