import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { InsufficientBalanceError, InvalidJournalEntryError } from '../../ledger/ledger.errors';
import { NotFoundError } from '../errors/domain-error';
import { ProblemFilter } from './problem.filter';

function run(exception: unknown) {
  const res = {
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    type() {
      return this;
    },
    json(body: unknown) {
      this.payload = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ id: 'req-1' }), getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new ProblemFilter().catch(exception, host);
  return res;
}

describe('ProblemFilter', () => {
  it('maps domain errors by kind with their stable code', () => {
    const res = run(new InsufficientBalanceError('not enough', { a: 1 }));
    expect(res.statusCode).toBe(422);
    expect(res.payload).toMatchObject({
      code: 'LEDGER_INSUFFICIENT_BALANCE',
      detail: 'not enough',
      requestId: 'req-1',
    });
    expect(run(new NotFoundError('nope')).statusCode).toBe(404);
  });

  it('hides the details of invariant violations', () => {
    const res = run(new InvalidJournalEntryError('debits must equal credits', { secret: true }));
    expect(res.statusCode).toBe(500);
    expect(res.payload).toMatchObject({ detail: 'Internal error' });
    expect(res.payload).not.toHaveProperty('details.secret');
  });

  it('keeps validation messages from HTTP exceptions', () => {
    const res = run(new BadRequestException(['amount must be a string']));
    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatchObject({ code: 'BAD_REQUEST', detail: 'amount must be a string' });
  });

  it('never leaks unexpected errors', () => {
    const res = run(new Error('connection string postgres://secret'));
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.payload)).not.toContain('secret');
  });
});
