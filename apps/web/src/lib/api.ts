import type { Session } from './types';

/** RFC 9457 problem+json, as every lending-api error is shaped. */
export interface Problem {
  type?: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail || problem.title);
  }
  get status() {
    return this.problem.status;
  }
  get code() {
    return this.problem.code;
  }
}

/*
 * Session tokens.
 *
 * The access token (15 min) lives only in this module's memory: never in localStorage or
 * sessionStorage, where any injected script could read it. The refresh token is an httpOnly
 * cookie the browser sends to /api/v1/auth only; JavaScript never sees it. A reload therefore
 * starts with no access token and silently gets a new one from the cookie.
 */
let accessToken: string | null = null;
let refreshing: Promise<Session | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

let sessionListener: (session: Session | null) => void = () => {};
/** The session provider learns about refreshes and expiries that happen inside api(). */
export const onSessionChange = (fn: (session: Session | null) => void) => {
  sessionListener = fn;
};

const CSRF = { 'X-CSRF-Protection': '1' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exchanges the refresh cookie for a new access token. Single-flight: concurrent callers (many
 * queries hitting 401 at once) share one request, because each refresh rotates the cookie.
 */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: CSRF });
        if (res.ok) {
          const session = (await res.json()) as Session;
          accessToken = session.accessToken;
          return session;
        }
        const problem = (await res.json().catch(() => ({}))) as Partial<Problem>;
        // Another tab rotated the cookie a moment ago; the browser now holds the new one.
        if (problem.code !== 'REFRESH_TOKEN_SUPERSEDED') break;
        await sleep(150);
      }
    } catch {
      /* offline or API down: treated as signed out */
    }
    accessToken = null;
    return null;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function signOut(): Promise<void> {
  accessToken = null;
  await fetch('/api/v1/auth/logout', { method: 'POST', headers: CSRF }).catch(() => undefined);
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Required by the API on every money-moving POST. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function api<T>(
  path: string,
  options: RequestOptions = {},
  retried = false,
): Promise<T> {
  const token = accessToken;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError({
      title: 'Network error',
      status: 0,
      code: 'NETWORK_ERROR',
      detail: 'Could not reach Acme Credit. Check that the API is running.',
    });
  }

  // Expired access token: refresh once and replay. Safe for writes too, because they carry
  // an Idempotency-Key and the server never acted on a request it rejected as unauthenticated.
  if (response.status === 401 && token && !retried && !path.startsWith('/v1/auth/')) {
    const session = await refreshSession();
    sessionListener(session);
    if (session) return api<T>(path, options, true);
  }
  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const problem = (payload ?? {}) as Partial<Problem>;
    throw new ApiError({
      title: problem.title ?? response.statusText,
      status: response.status,
      code: problem.code ?? 'HTTP_ERROR',
      detail: problem.detail ?? `Request failed with status ${response.status}`,
      details: problem.details,
      requestId: problem.requestId ?? response.headers.get('X-Request-Id') ?? undefined,
    });
  }
  return payload as T;
}

export const newIdempotencyKey = () => crypto.randomUUID();

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
