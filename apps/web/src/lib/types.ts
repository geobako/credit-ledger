import type { Money } from './money';

export type Role = 'customer' | 'ops';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Session {
  user: User;
  accessToken: string;
  expiresIn: number;
}

export type AccountStatus = 'PENDING_COLLATERAL' | 'ACTIVE' | 'CLOSED';
export type CardStatus = 'INACTIVE' | 'ACTIVE' | 'FROZEN' | 'CLOSED';

export interface Card {
  id: string;
  status: CardStatus;
  last4: string;
  expiryMonth: number;
  expiryYear: number;
}

export interface CreditAccount {
  id: string;
  customerId: string;
  status: AccountStatus;
  currency: string;
  advanceRateBps: number;
  collateral: Money;
  refundDue: Money;
  creditLimit: Money;
  outstandingBalance: Money;
  heldAmount: Money;
  availableCredit: Money;
  card: Card | null;
  createdAt: string;
  activatedAt: string | null;
  closedAt: string | null;
}

export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'SETTLED' | 'FAILED' | 'REJECTED';

export interface Deposit {
  id: string;
  creditAccountId: string;
  amount: Money;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REJECTED';
  providerReference: string;
  failureReason: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface Repayment {
  id: string;
  creditAccountId: string;
  amount: Money;
  status: 'PENDING' | 'SETTLED' | 'FAILED' | 'REJECTED';
  appliedAmount: Money | null;
  excessAmount: Money | null;
  providerReference: string;
  failureReason: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface PaymentInstructions {
  provider: string;
  reference: string;
  amount: Money;
  note: string;
}

export type AuthorizationStatus = 'HELD' | 'CAPTURED' | 'REVERSED' | 'EXPIRED' | 'DECLINED';

export interface Authorization {
  id: string;
  creditAccountId: string;
  cardId: string;
  networkTransactionId: string;
  status: AuthorizationStatus;
  amount: Money;
  capturedAmount: Money | null;
  declineReason: string | null;
  merchantName: string;
  merchantCategoryCode: string | null;
  expiresAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AuthorizationDecision {
  networkTransactionId: string;
  authorizationId: string | null;
  approved: boolean;
  status: 'HELD' | 'DECLINED';
  declineReason: string | null;
  amount: Money;
}

export interface Closure {
  creditAccountId: string;
  reason: 'CUSTOMER_REQUEST' | 'CHARGE_OFF';
  debtAtClosure: Money;
  refundApplied: Money;
  collateralApplied: Money;
  writtenOff: Money;
  payout: Money;
  closedAt: string;
}

export interface ActivityItem {
  seq: string;
  occurredAt: string;
  actor: { type: string; id?: string | null };
  action: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
}

export interface AuditEntry extends ActivityItem {
  creditAccountId: string | null;
  requestId: string | null;
  chainPosition: string | null;
  hash: string | null;
}

export interface ChainVerification {
  ok: boolean;
  sealedEntries: number;
  unsealedEntries: number;
  brokenAt?: string;
  reason?: string;
}

export interface Posting {
  accountId: string;
  accountKind: string;
  ownerId: string | null;
  direction: 'DEBIT' | 'CREDIT';
  amount: Money;
}

export interface JournalEntry {
  id: string;
  type: string;
  reference: string | null;
  description: string;
  createdAt: string;
  postings: Posting[];
}

export interface ReconciliationReport {
  ok: boolean;
  checkedAt: string;
  checks: {
    name: string;
    description: string;
    ok: boolean;
    discrepancies: Record<string, unknown>[];
  }[];
}

export interface Overview {
  accountsByStatus: Partial<Record<AccountStatus, number>>;
  active: { creditLimit: Money; outstanding: Money; held: Money };
  systemAccounts: Record<string, Money>;
  outbox: { pending: number; oldestPendingSeconds: number | null };
}

export interface OutboxEvent {
  id: string;
  seq: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  publishedAt: string | null;
  attempts: number;
  lastError: string | null;
}
