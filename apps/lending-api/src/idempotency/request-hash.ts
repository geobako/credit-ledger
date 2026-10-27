import { createHash } from 'node:crypto';

/** JSON with object keys sorted recursively, so semantically equal bodies hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** Fingerprint of what a client asked for; a reused key must come with the same fingerprint. */
export function hashRequest(request: { method: string; path: string; body?: unknown }): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        method: request.method.toUpperCase(),
        path: request.path,
        body: request.body ?? null,
      }),
    )
    .digest('hex');
}
