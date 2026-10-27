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

const SESSION_KEY = 'acme-session';

/**
 * The access token lives in sessionStorage: it survives a reload but not the tab, and is
 * scoped to this origin. (A production app would use the IdP's httpOnly cookie flow.)
 */
export const sessionStore = {
  read(): Session | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  write(session: Session | null) {
    try {
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable: session stays in memory only */
    }
  },
};

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Required by the API on every money-moving POST. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const session = sessionStore.read();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
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

  if (response.status === 401 && session) onUnauthorized();
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
