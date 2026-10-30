import { Injectable, Logger } from '@nestjs/common';
import type { User } from '../database/schema';
import { TransactionManager } from '../database/transaction-manager';
import { InvalidCredentialsError } from './auth.errors';
import { dummyPasswordHash, hashPassword, verifyPassword } from './passwords';
import { IssuedRefreshToken, SessionsService } from './sessions.service';
import { TokenService } from './token.service';
import { UsersService } from './users.service';

export interface SignedIn {
  user: User;
  accessToken: string;
  expiresIn: number;
  refreshToken: IssuedRefreshToken;
}

/**
 * Sign-up, sign-in, refresh and sign-out. Stands in for an external identity provider; the
 * rest of the service only ever sees the short-lived access token.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly tokens: TokenService,
    private readonly tx: TransactionManager,
  ) {}

  async register(email: string, name: string, password: string): Promise<SignedIn> {
    const passwordHash = await hashPassword(password);
    return this.users.registerCustomer(email, name, passwordHash, async (tx, user) =>
      this.signedIn(user, await this.sessions.start(tx, user)),
    );
  }

  async login(email: string, password: string): Promise<SignedIn> {
    const user = await this.users.findByEmail(email);
    // Always run one hash verification, so timing does not reveal whether the email exists.
    const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user || !user.passwordHash || !ok) {
      this.logger.warn({ userId: user?.id ?? null }, 'sign-in failed');
      throw new InvalidCredentialsError('invalid email or password');
    }
    const refreshToken = await this.tx.run((tx) => this.sessions.start(tx, user));
    return this.signedIn(user, refreshToken);
  }

  async refresh(token: string): Promise<SignedIn> {
    const { user, refreshToken } = await this.sessions.rotate(token);
    return this.signedIn(user, refreshToken);
  }

  logout(token: string): Promise<void> {
    return this.sessions.revoke(token);
  }

  private signedIn(user: User, refreshToken: IssuedRefreshToken): SignedIn {
    const access = this.tokens.issue({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: refreshToken.sessionId,
    });
    return { user, ...access, refreshToken };
  }
}
