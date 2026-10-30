import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NotFoundError } from '../common/errors/domain-error';
import type { Database, Transaction } from '../database/database';
import { DB } from '../database/database.module';
import { isPgError, PgErrorCode } from '../database/pg-errors';
import { User, users } from '../database/schema';
import { DomainEvents } from '../events/domain-events';
import { EmailTakenError } from './auth.errors';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: DomainEvents,
  ) {}

  /**
   * Creates a customer. With `then`, more work (starting a session) joins the same transaction,
   * so a registration never exists without its first session or vice versa.
   */
  async registerCustomer<T = User>(
    email: string,
    name: string,
    passwordHash: string | null = null,
    then?: (tx: Transaction, user: User) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email: email.toLowerCase(), name, role: 'customer', passwordHash })
          .returning();
        // No email or name: the audit trail is immutable and must not hold personal data.
        await this.events.emit(tx, {
          type: 'CustomerRegistered',
          entityType: 'user',
          entityId: user!.id,
          data: { userId: user!.id, role: user!.role },
        });
        return then ? then(tx, user!) : (user! as T);
      });
    } catch (error) {
      if (isPgError(error, PgErrorCode.UniqueViolation)) {
        throw new EmailTakenError('an account with this email already exists');
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async get(id: string): Promise<User> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    if (!user) throw new NotFoundError('user not found');
    return user;
  }
}
