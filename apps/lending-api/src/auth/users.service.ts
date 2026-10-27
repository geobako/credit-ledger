import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NotFoundError } from '../common/errors/domain-error';
import type { Database } from '../database/database';
import { DB } from '../database/database.module';
import { isPgError, PgErrorCode } from '../database/pg-errors';
import { User, users } from '../database/schema';
import { EmailTakenError } from './auth.errors';

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async registerCustomer(email: string, name: string): Promise<User> {
    try {
      const [user] = await this.db
        .insert(users)
        .values({ email: email.toLowerCase(), name, role: 'customer' })
        .returning();
      return user!;
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
