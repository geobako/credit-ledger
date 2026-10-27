# Architecture decision records

Short records of the decisions that shape the system: the context, what was decided, what it
costs, and what was rejected.

| #                                                           | Decision                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [0001](0001-one-service-owns-the-money.md)                  | One service owns the money; the card gateway is a separate, stateless edge                |
| [0002](0002-double-entry-ledger-in-postgres.md)             | Double-entry ledger in Postgres, integer minor units, invariants enforced by the database |
| [0003](0003-pessimistic-locking-per-credit-account.md)      | Pessimistic locking on the credit account row, plus a per-account in-process queue        |
| [0004](0004-idempotency-in-the-same-transaction.md)         | Idempotency records written in the same transaction as the effect                         |
| [0005](0005-transactional-outbox-and-hash-chained-audit.md) | Transactional outbox for events; hash-chained audit log                                   |
| [0006](0006-fail-closed-gateway-with-compensation.md)       | The card gateway fails closed and compensates late approvals                              |
| [0007](0007-aws-ecs-fargate-and-rds.md)                     | AWS: ECS Fargate, RDS Postgres Multi-AZ, CloudFront; Drizzle with SQL migrations          |
