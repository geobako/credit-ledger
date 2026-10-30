import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, refreshSession, setAccessToken } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const session = (token: string) => ({
  user: { id: 'u1', email: 'a@b.c', name: 'A', role: 'customer' },
  accessToken: token,
  expiresIn: 900,
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('session handling in the API client', () => {
  it('refreshes once on 401 and replays the request with the new token', async () => {
    setAccessToken('expired');
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      if (url.endsWith('/auth/refresh')) return json(200, session('fresh'));
      return auth === 'Bearer fresh'
        ? json(200, { ok: true })
        : json(401, { code: 'UNAUTHENTICATED' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/v1/credit-accounts')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/credit-accounts',
      '/api/v1/auth/refresh',
      '/api/v1/credit-accounts',
    ]);
  });

  it('shares one refresh between concurrent callers (each refresh rotates the cookie)', async () => {
    let refreshes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, session('fresh'));
      }),
    );
    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(refreshes).toBe(1);
    expect(results.every((s) => s?.accessToken === 'fresh')).toBe(true);
  });

  it('retries once when another tab rotated the cookie first', async () => {
    const responses = [
      json(401, { code: 'REFRESH_TOKEN_SUPERSEDED' }),
      json(200, session('fresh')),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => responses.shift()!),
    );
    await expect(refreshSession()).resolves.toMatchObject({ accessToken: 'fresh' });
  });

  it('reports signed-out when the session is gone, and does not loop', async () => {
    setAccessToken('expired');
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/auth/refresh')
        ? json(401, { code: 'INVALID_REFRESH_TOKEN' })
        : json(401, { code: 'UNAUTHENTICATED', title: 'Unauthorized', detail: 'expired' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('/v1/credit-accounts')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends the CSRF header on refresh and never an Authorization header', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json(200, session('fresh')),
    );
    vi.stubGlobal('fetch', fetchMock);
    await refreshSession();
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.headers).toEqual({ 'X-CSRF-Protection': '1' });
  });
});
