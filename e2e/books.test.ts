/** Runs last: after everything above, the books must still be perfect. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { expect, ops } from './lib/stack.ts';

const until = async <T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
};

describe('books', () => {
  test('reconciliation passes every check', async () => {
    const res = await (await ops()).get('/v1/ops/reconciliation');
    expect(res, 200);
    const failed = res.body.checks.filter((c: { ok: boolean }) => !c.ok);
    assert.deepEqual(failed, [], JSON.stringify(failed, null, 2));
  });

  test('the audit hash chain verifies and every entry gets sealed', async () => {
    const admin = await ops();
    const result = await until(
      async () => (await admin.get('/v1/ops/audit/verify')).body,
      (v) => v.ok === false || v.unsealedEntries === 0,
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.unsealedEntries, 0);
  });

  test('the outbox relay publishes every event', async () => {
    const admin = await ops();
    const overview = await until(
      async () => (await admin.get('/v1/ops/overview')).body,
      (v) => v.outbox.pending === 0,
    );
    assert.equal(overview.outbox.pending, 0);
  });
});
