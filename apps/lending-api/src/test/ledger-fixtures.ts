import { randomUUID } from 'node:crypto';
import { Money } from '../common/money/money';
import type { Transaction } from '../database/database';
import { transfer } from '../ledger/journal-entry';
import { LedgerService } from '../ledger/ledger.service';
import { TestDatabase } from './database';

export const usd = (minor: bigint | number) => Money.of(BigInt(minor));

/** A fresh customer with collateral and receivable accounts, plus the shared system accounts. */
export async function createCustomerAccounts(t: TestDatabase, ledger: LedgerService) {
  const ownerId = randomUUID();
  return t.tx.run(async (tx) => ({
    ownerId,
    collateralHeld: await ledger.ensureAccount(tx, 'COLLATERAL_HELD', ownerId),
    receivable: await ledger.ensureAccount(tx, 'CARD_RECEIVABLE', ownerId),
    collateralCash: await ledger.ensureAccount(tx, 'COLLATERAL_CASH'),
    merchantPayable: await ledger.ensureAccount(tx, 'MERCHANT_PAYABLE'),
    operatingCash: await ledger.ensureAccount(tx, 'OPERATING_CASH'),
  }));
}

export type CustomerAccounts = Awaited<ReturnType<typeof createCustomerAccounts>>;

/** Collateral confirmed: DR collateral cash / CR customer's collateral held. */
export function depositCollateral(
  tx: Transaction,
  ledger: LedgerService,
  accounts: CustomerAccounts,
  amount: Money,
  reference?: string,
) {
  return ledger.post(tx, {
    type: 'COLLATERAL_CONFIRMED',
    description: 'collateral deposit confirmed',
    reference,
    postings: transfer(accounts.collateralCash.id, accounts.collateralHeld.id, amount),
  });
}
