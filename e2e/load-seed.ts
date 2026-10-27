/**
 * Creates the cards the load test spends on and writes their network tokens to
 * load/.fixtures.json. Runs before k6 (k6 cannot read the issuer database).
 *
 *   pnpm --filter e2e load:seed [cards=100]
 */
import { writeFileSync } from 'node:fs';
import { activeCustomer } from './lib/stack.ts';

const count = Number(process.argv[2] ?? 100);
const COLLATERAL = 100_000; // $1,000 per card

const tokens: string[] = [];
for (let i = 0; i < count; i += 10) {
  const batch = await Promise.all(
    Array.from({ length: Math.min(10, count - i) }, () => activeCustomer(COLLATERAL, 'load')),
  );
  tokens.push(...batch.map((c) => c.token));
}
const hot = await activeCustomer(COLLATERAL, 'load-hot');

const file = new URL('../load/.fixtures.json', import.meta.url);
writeFileSync(file, JSON.stringify({ cards: tokens, hotCard: hot.token }, null, 2));
console.log(`seeded ${tokens.length} cards + 1 hot card → ${file.pathname}`);
