import { eq } from 'drizzle-orm';
import { DEMO_PASSWORD } from '../database/seed';
import { auditLog, refreshTokens } from '../database/schema';
import { createTestApp, idemKey, TestApp } from '../test/app';

/**
 * Sign-in, refresh-token rotation, reuse detection and sign-out, over HTTP.
 * Sign-in is rate limited (10/min per IP), so tests that only need *a* session register a
 * fresh customer instead (registration has its own bucket).
 */
describe('sessions (HTTP)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const csrf = { 'X-CSRF-Protection': '1' };

  /** The refresh cookie from a response, as `name=value` ready to send back. */
  const refreshCookie = (res: { headers: Record<string, unknown> }): string => {
    const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
    const cookie = cookies.find((c) => c.startsWith('acme_refresh='));
    if (!cookie) throw new Error(`no refresh cookie in ${JSON.stringify(cookies)}`);
    return cookie.split(';')[0]!;
  };

  const login = (email: string, password = DEMO_PASSWORD) =>
    t.http.post('/v1/auth/login').send({ email, password });

  const newSession = async () =>
    refreshCookie(
      await t.http
        .post('/v1/auth/register')
        .send({
          email: `s-${idemKey()}@acme.test`,
          name: 'Session Test',
          password: 'a-long-enough-password',
        })
        .expect(201),
    );

  const refresh = (cookie: string) =>
    t.http.post('/v1/auth/refresh').set(csrf).set('Cookie', cookie);

  const detail = (res: { body: unknown }) => (res.body as { detail: string }).detail;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('signs in with email and password: access token in the body, refresh token in a hardened cookie', async () => {
    const res = await login('alice@acme.test').expect(200);
    expect(res.body).toMatchObject({
      user: { email: 'alice@acme.test', role: 'customer' },
      expiresIn: 900,
    });
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(res.headers['cache-control']).toBe('no-store');

    const raw = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('acme_refresh='),
    )!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(raw).toMatch(/Path=\/api\/v1\/auth/);
    expect(raw).toMatch(/Max-Age=\d+/);

    await t.http
      .get('/v1/me')
      .set('Authorization', `Bearer ${(res.body as { accessToken: string }).accessToken}`)
      .expect(200);

    // Only a SHA-256 of the token is stored: a database leak yields no usable sessions.
    const token = decodeURIComponent(refreshCookie(res).split('=')[1]!);
    const rows = await t.db.select().from(refreshTokens);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tokenHash !== token && /^[0-9a-f]{64}$/.test(r.tokenHash))).toBe(
      true,
    );
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await login('alice@acme.test', 'not-the-password').expect(401);
    const unknown = await login('nobody@acme.test', 'not-the-password').expect(401);
    expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(detail(unknown)).toBe(detail(wrong));
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('requires a strong enough password at registration and never stores it in clear', async () => {
    const email = `pw-${idemKey()}@acme.test`;
    await t.http
      .post('/v1/auth/register')
      .send({ email, name: 'Short', password: 'short' })
      .expect(400);
    await t.http
      .post('/v1/auth/register')
      .send({ email, name: 'Strong', password: 'correct horse battery staple' })
      .expect(201);
    const stored = await t.db.query.users.findFirst({
      where: (u, { eq: equals }) => equals(u.email, email),
    });
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(stored?.passwordHash).not.toContain('correct horse');
    await login(email, 'correct horse battery staple').expect(200);
  });

  it('rotates the refresh token on every use and issues a working access token', async () => {
    const first = await newSession();
    const res = await refresh(first).expect(200);
    const second = refreshCookie(res);
    expect(second).not.toBe(first);
    await t.http
      .get('/v1/me')
      .set('Authorization', `Bearer ${(res.body as { accessToken: string }).accessToken}`)
      .expect(200);
    await refresh(second).expect(200);
  });

  it('treats a just-rotated token presented again as a concurrent refresh, not theft', async () => {
    const first = await newSession();
    const second = refreshCookie(await refresh(first).expect(200));
    const again = await refresh(first).expect(401);
    expect(again.body).toMatchObject({ code: 'REFRESH_TOKEN_SUPERSEDED' });
    expect(again.headers['set-cookie']).toBeUndefined(); // keeps the newer cookie
    await refresh(second).expect(200); // the session survives
  });

  it('revokes the whole session when a consumed token is replayed later (stolen token)', async () => {
    const stolen = await newSession();
    const victim = refreshCookie(await refresh(stolen).expect(200));
    await sleep(1_100); // past the (test) grace window

    const replay = await refresh(stolen).expect(401);
    expect(replay.body).toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    // The legitimate holder is signed out too: nobody keeps a possibly-compromised session.
    await refresh(victim).expect(401);

    const revocations = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'SessionRevoked'));
    expect(
      revocations.some((r) => (r.data as { reason?: string }).reason === 'REFRESH_TOKEN_REUSE'),
    ).toBe(true);
  });

  it('ends the session on sign-out', async () => {
    const cookie = await newSession();
    const res = await t.http.post('/v1/auth/logout').set(csrf).set('Cookie', cookie).expect(204);
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/acme_refresh=;/);
    await refresh(cookie).expect(401);
  });

  it('refuses expired sessions', async () => {
    const cookie = await newSession();
    await t.db.update(refreshTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    await refresh(cookie).expect(401);
  });

  it('needs the CSRF header and a cookie', async () => {
    const cookie = await newSession();
    const blocked = await t.http.post('/v1/auth/refresh').set('Cookie', cookie).expect(403);
    expect(blocked.body).toMatchObject({ code: 'CSRF_HEADER_REQUIRED' });
    await t.http.post('/v1/auth/logout').set('Cookie', cookie).expect(403);
    await t.http.post('/v1/auth/refresh').set(csrf).expect(401);
    await refresh('acme_refresh=forged-token-value').expect(401);
  });
});
