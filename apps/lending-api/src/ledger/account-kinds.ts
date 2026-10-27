/**
 * Chart of accounts. "customer" accounts exist once per credit account (owner_id);
 * "system" accounts are singletons per currency.
 *
 * Typical flows (DR / CR):
 *   collateral confirmed   COLLATERAL_CASH   / COLLATERAL_HELD
 *   purchase captured      CARD_RECEIVABLE   / MERCHANT_PAYABLE
 *   repayment settled      OPERATING_CASH    / CARD_RECEIVABLE
 *   collateral released    COLLATERAL_HELD   / COLLATERAL_CASH
 *   collateral applied     COLLATERAL_HELD   / CARD_RECEIVABLE  (+ cash moves COLLATERAL_CASH → OPERATING_CASH)
 *   shortfall written off  CREDIT_LOSS       / CARD_RECEIVABLE
 *   fee charged            CARD_RECEIVABLE   / FEE_INCOME
 */
export const ACCOUNT_KINDS = {
  COLLATERAL_HELD: {
    category: 'LIABILITY',
    scope: 'customer',
    allowNegative: false,
    description: "Customer's collateral deposit, owed back to them",
  },
  CARD_RECEIVABLE: {
    category: 'ASSET',
    scope: 'customer',
    allowNegative: false,
    description: 'What the customer owes on their card',
  },
  COLLATERAL_CASH: {
    category: 'ASSET',
    scope: 'system',
    allowNegative: false,
    description: 'Segregated cash backing all collateral deposits',
  },
  OPERATING_CASH: {
    category: 'ASSET',
    scope: 'system',
    // Card settlement can be paid out before repayments arrive (funded by the company).
    allowNegative: true,
    description: 'Company operating cash',
  },
  MERCHANT_PAYABLE: {
    category: 'LIABILITY',
    scope: 'system',
    allowNegative: false,
    description: 'Captured purchases owed to the card network / merchants',
  },
  FEE_INCOME: {
    category: 'REVENUE',
    scope: 'system',
    allowNegative: false,
    description: 'Fees and interest earned',
  },
  CREDIT_LOSS: {
    category: 'EXPENSE',
    scope: 'system',
    allowNegative: false,
    description: 'Debt written off after collateral was exhausted',
  },
} as const satisfies Record<string, AccountKindSpec>;

export interface AccountKindSpec {
  category: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  scope: 'customer' | 'system';
  allowNegative: boolean;
  description: string;
}

export type AccountKind = keyof typeof ACCOUNT_KINDS;

export function isDebitNormal(category: AccountKindSpec['category']): boolean {
  return category === 'ASSET' || category === 'EXPENSE';
}
