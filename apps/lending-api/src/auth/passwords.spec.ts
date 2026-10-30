import { dummyPasswordHash, hashPassword, verifyPassword } from './passwords';

describe('passwords', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(hash).not.toContain('correct horse');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyPassword('correct horse battery stapl', hash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password here')).not.toBe(
      await hashPassword('same password here'),
    );
  });

  it('normalizes unicode so the same password typed differently still matches', async () => {
    const composed = 'café-password-1';
    const decomposed = 'café-password-1';
    await expect(verifyPassword(decomposed, await hashPassword(composed))).resolves.toBe(true);
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    await expect(verifyPassword('anything', 'plaintext')).resolves.toBe(false);
    await expect(verifyPassword('anything', await dummyPasswordHash())).resolves.toBe(false);
  });
});
