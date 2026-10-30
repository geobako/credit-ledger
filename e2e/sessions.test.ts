/**
 * Sessions through the web app's proxy, exactly as a browser sees them: the refresh cookie is
 * scoped to /api/v1/auth, rotates on every refresh, and dies on sign-out.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { config, expect, http } from './lib/stack.ts';

const csrf = { 'x-csrf-protection': '1' };

function refreshCookie(headers: Headers): { pair: string; attributes: string } {
  const raw = headers.getSetCookie().find((c) => c.startsWith('acme_refresh='));
  assert.ok(raw, 'expected a refresh cookie');
  const [pair, ...attributes] = raw.split(';');
  return { pair: pair!, attributes: attributes.join(';') };
}

describe('sessions (through the web proxy)', () => {
  const email = `session-${randomUUID().slice(0, 8)}@e2e.test`;
  const password = 'e2e-password-long-enough';
  let cookie: string;
  let access: string;

  test('registration sets a hardened, path-scoped refresh cookie and no token in the body', async () => {
    const res = await http(`${config.web}/api/v1/auth/register`, {
      body: { email, name: 'E2E Session', password },
    });
    expect(res, 201);
    assert.ok(res.body.accessToken);
    assert.equal(res.body.refreshToken, undefined);
    const { pair, attributes } = refreshCookie(res.headers);
    assert.match(attributes, /HttpOnly/i);
    assert.match(attributes, /SameSite=Strict/i);
    assert.match(attributes, /Path=\/api\/v1\/auth/);
    cookie = pair;
  });

  test('the password signs in; a wrong one does not', async () => {
    expect(await http(`${config.web}/api/v1/auth/login`, { body: { email, password } }), 200);
    const wrong = await http(`${config.web}/api/v1/auth/login`, {
      body: { email, password: 'not-the-password' },
    });
    expect(wrong, 401);
    assert.equal(wrong.body.code, 'INVALID_CREDENTIALS');
  });

  test('refresh rotates the cookie and returns a working access token', async () => {
    const res = await http(`${config.web}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { ...csrf, cookie },
    });
    expect(res, 200);
    const next = refreshCookie(res.headers).pair;
    assert.notEqual(next, cookie);
    cookie = next;
    access = res.body.accessToken;
    const me = await http(`${config.web}/api/v1/me`, {
      headers: { authorization: `Bearer ${res.body.accessToken}` },
    });
    expect(me, 200);
    assert.equal(me.body.email, email);
  });

  test('refresh without the CSRF header is refused', async () => {
    expect(
      await http(`${config.web}/api/v1/auth/refresh`, { method: 'POST', headers: { cookie } }),
      403,
    );
  });

  test('sign-out revokes the session server-side, access token included', async () => {
    expect(
      await http(`${config.web}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { ...csrf, cookie },
      }),
      204,
    );
    expect(
      await http(`${config.web}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { ...csrf, cookie },
      }),
      401,
    );
    // The access token dies with its session instead of living out its 15 minutes.
    expect(
      await http(`${config.web}/api/v1/me`, { headers: { authorization: `Bearer ${access}` } }),
      401,
    );
  });
});
