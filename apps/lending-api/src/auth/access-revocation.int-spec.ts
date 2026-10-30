import { eq } from 'drizzle-orm';
import { refreshTokens } from '../database/schema';
import { createTestApp, idemKey, TestApp } from '../test/app';

/**
 * Access tokens die with their session: sign-out and theft revocation take effect at once,
 * not when the 15-minute token would have expired.
 */
describe('access-token revocation (HTTP)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const csrf = { 'X-CSRF-Protection': '1' };
  const password = 'a-long-enough-password';
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const cookieOf = (res: { headers: Record<string, unknown> }) =>
    (res.headers['set-cookie'] as string[])
      .find((c) => c.startsWith('acme_refresh='))!
      .split(';')[0]!;
  const accessOf = (res: { body: unknown }) => (res.body as { accessToken: string }).accessToken;

  const register = (email = `a-${idemKey()}@acme.test`) =>
    t.http.post('/v1/auth/register').send({ email, name: 'Access Test', password }).expect(201);
  const me = (access: string) => t.http.get('/v1/me').set('Authorization', `Bearer ${access}`);
  const logout = (cookie: string) =>
    t.http.post('/v1/auth/logout').set(csrf).set('Cookie', cookie).expect(204);
  const refresh = (cookie: string) =>
    t.http.post('/v1/auth/refresh').set(csrf).set('Cookie', cookie);

  it('sign-out invalidates the access token immediately, not when it expires', async () => {
    const res = await register();
    await me(accessOf(res)).expect(200);
    await logout(cookieOf(res));
    const after = await me(accessOf(res)).expect(401);
    expect(after.body).toMatchObject({ code: 'UNAUTHENTICATED', detail: 'this session has ended' });
  });

  it('a revoked (stolen) session loses its access tokens too', async () => {
    const res = await register();
    const stolen = cookieOf(res);
    const victim = cookieOf(await refresh(stolen).expect(200));
    await sleep(1_100); // past the (test) grace window
    await refresh(stolen).expect(401); // reuse → the whole session is revoked
    await me(accessOf(res)).expect(401);
    await refresh(victim).expect(401);
  });

  it('honours a revocation made by another replica within the cache window', async () => {
    const access = accessOf(await register());
    await me(access).expect(200); // this replica now caches "active"
    // Another replica signs the session out: only the database knows.
    const { sid } = JSON.parse(Buffer.from(access.split('.')[1]!, 'base64url').toString()) as {
      sid: string;
    };
    await t.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.familyId, sid));
    await sleep(400); // SESSION_CHECK_CACHE_MS is 300 in tests
    await me(access).expect(401);
  });

  it("signing out one device leaves the user's other sessions alone", async () => {
    const email = `multi-${idemKey()}@acme.test`;
    const laptop = await register(email);
    const phone = await t.http.post('/v1/auth/login').send({ email, password }).expect(200);
    await logout(cookieOf(laptop));
    await me(accessOf(laptop)).expect(401);
    await me(accessOf(phone)).expect(200);
  });
});
