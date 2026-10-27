/**
 * The whole secured-card lifecycle in good standing, with purchases arriving through the Go
 * gateway exactly as a card network would send them.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  authorize,
  capture,
  cardToken,
  depositAndConfirm,
  deliverPaymentEvent,
  expect,
  getAccount,
  minor,
  newCustomer,
  openAccount,
  repayAndConfirm,
  reverse,
  type Account,
  type Actor,
} from './lib/stack.ts';

describe('secured card lifecycle (good standing)', () => {
  let customer: Actor;
  let account: Account;
  let token: string;
  const view = () => getAccount(customer, account.id);

  test('a new account starts with an inactive card and no credit', async () => {
    customer = await newCustomer('lifecycle');
    account = await openAccount(customer);
    token = await cardToken(account.card.id);
    assert.equal(account.status, 'PENDING_COLLATERAL');
    assert.equal(account.card.status, 'INACTIVE');
    assert.equal(minor(account.creditLimit), 0n);
  });

  test('the card is declined before collateral is confirmed', async () => {
    const res = await authorize(token, 1_000);
    expect(res, 200);
    assert.equal(res.body.approved, false);
    assert.equal(res.body.response_code, '78'); // blocked, first use
  });

  test('a deposit only counts once the provider confirms it', async () => {
    const started = await customer.post(`/v1/credit-accounts/${account.id}/collateral-deposits`, {
      amount: '50000',
    });
    expect(started, 201);
    assert.equal(minor((await view()).creditLimit), 0n, 'pending deposit grants no credit');

    const ack = await deliverPaymentEvent({
      type: 'payment.succeeded',
      reference: started.body.paymentInstructions.reference,
      amount: '50000',
    });
    expect(ack, 200);
    assert.equal(ack.body.outcome, 'CONFIRMED');

    const active = await view();
    assert.equal(active.status, 'ACTIVE');
    assert.equal(active.card.status, 'ACTIVE');
    assert.equal(minor(active.creditLimit), 50_000n, 'limit = collateral (100% advance rate)');
  });

  test('more collateral raises the limit', async () => {
    await depositAndConfirm(customer, account.id, 20_000);
    const a = await view();
    assert.equal(minor(a.collateral), 70_000n);
    assert.equal(minor(a.creditLimit), 70_000n);
  });

  let purchase: string;
  test('a purchase within the limit is approved as a hold', async () => {
    const res = await authorize(token, 12_000, { merchant: 'Blue Bottle Coffee' });
    expect(res, 200);
    assert.equal(res.body.response_code, '00');
    assert.ok(res.body.authorization_id);
    purchase = res.body.authorization_id;

    const a = await view();
    assert.equal(minor(a.heldAmount), 12_000n);
    assert.equal(minor(a.availableCredit), 58_000n);
  });

  test('a purchase beyond available credit is declined with 51', async () => {
    const res = await authorize(token, 58_001);
    assert.equal(res.body.approved, false);
    assert.equal(res.body.response_code, '51');
    assert.equal(minor((await view()).heldAmount), 12_000n, 'declines reserve nothing');
  });

  test('a partial capture turns the hold into debt and releases the rest', async () => {
    const res = await capture(purchase, 10_000);
    expect(res, 200);
    const a = await view();
    assert.equal(minor(a.outstandingBalance), 10_000n);
    assert.equal(minor(a.heldAmount), 0n);
    assert.equal(minor(a.availableCredit), 60_000n);
  });

  test('a reversed authorization releases its hold', async () => {
    const res = await authorize(token, 5_000);
    assert.equal(res.body.response_code, '00');
    expect(await reverse(res.body.authorization_id!), 200);
    assert.equal(minor((await view()).heldAmount), 0n);
  });

  test('a captured purchase can no longer be reversed', async () => {
    const res = await reverse(purchase);
    expect(res, 409);
  });

  test('repaying restores available credit', async () => {
    await repayAndConfirm(customer, account.id, 10_000);
    const a = await view();
    assert.equal(minor(a.outstandingBalance), 0n);
    assert.equal(minor(a.availableCredit), 70_000n);
  });

  test('closing in good standing returns all collateral', async () => {
    const res = await customer.post(`/v1/credit-accounts/${account.id}/closure`, {});
    expect(res, 200);
    assert.equal(res.body.payout.amount, '70000');
    assert.equal(res.body.collateralApplied.amount, '0');

    const a = await view();
    assert.equal(a.status, 'CLOSED');
    assert.equal(a.card.status, 'CLOSED');
    assert.equal(minor(a.collateral), 0n);
  });

  test('the closed card is declined by the network', async () => {
    const res = await authorize(token, 100);
    assert.equal(res.body.approved, false);
    assert.equal(res.body.response_code, '46');
  });

  test('the activity timeline tells the whole story in order', async () => {
    const res = await customer.get<{ action: string }[]>(
      `/v1/credit-accounts/${account.id}/activity`,
    );
    expect(res, 200);
    const actions = res.body.map((e) => e.action).reverse();
    const story = [
      'CreditAccountOpened',
      'AuthorizationDeclined',
      'CollateralDepositConfirmed',
      'CreditAccountActivated',
      'AuthorizationApproved',
      'AuthorizationCaptured',
      'AuthorizationReversed',
      'RepaymentSettled',
      'CreditAccountClosed',
    ];
    let cursor = 0;
    for (const action of actions) if (action === story[cursor]) cursor++;
    assert.equal(
      cursor,
      story.length,
      `missing or out of order after ${story[cursor]}: ${actions.join(', ')}`,
    );
  });
});
