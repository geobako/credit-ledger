import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { ENV, Env } from '../config/env';
import type { Database, Transaction } from '../database/database';
import { DB } from '../database/database.module';
import { refreshTokens, User, users } from '../database/schema';
import { TransactionManager } from '../database/transaction-manager';
import { DomainEvents } from '../events/domain-events';
import { InvalidRefreshTokenError, RefreshTokenSupersededError } from './auth.errors';

export interface IssuedRefreshToken {
  /** The session (token family) this token belongs to. */
  sessionId: string;
  token: string;
  /** Seconds until this token expires (cookie Max-Age). */
  maxAge: number;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

/**
 * Sessions as rotating refresh-token families.
 *
 *   sign-in   → new family, token #1
 *   refresh   → token #n is consumed, token #n+1 issued (same family)
 *   reuse     → a consumed token comes back: someone kept a copy. Revoke the whole family,
 *               so both the thief and the victim must sign in again.
 *   sign-out  → revoke the family
 *
 * Only SHA-256 hashes are stored: tokens are 256-bit random, so a fast hash is sufficient and a
 * database leak yields nothing usable.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  /**
   * Recent answers to "is this session still active?", so authenticating a request costs a
   * database read at most once per session per SESSION_CHECK_CACHE_MS in each process.
   * Revocations made by this process apply at once; other replicas see them within that window.
   */
  private readonly activeCache = new Map<string, { active: boolean; checkedAt: number }>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Database,
    private readonly tx: TransactionManager,
    private readonly events: DomainEvents,
  ) {}

  /** Starts a session for a user who just proved their identity. */
  async start(tx: Transaction, user: User): Promise<IssuedRefreshToken> {
    const familyId = randomUUID();
    const now = Date.now();
    const familyExpiresAt = new Date(now + this.env.SESSION_MAX_AGE_SECONDS * 1000);
    const issued = await this.insert(tx, user.id, familyId, familyExpiresAt, now);
    await this.events.emit(tx, {
      type: 'UserSignedIn',
      entityType: 'user',
      entityId: user.id,
      data: { userId: user.id, sessionId: familyId },
    });
    return issued;
  }

  /** Consumes a refresh token and issues its successor. */
  async rotate(token: string): Promise<{ user: User; refreshToken: IssuedRefreshToken }> {
    const outcome = await this.tx.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashToken(token)))
        .for('update');
      if (!row || row.revokedAt) return { kind: 'invalid' as const };

      const now = Date.now();
      if (row.usedAt) {
        if (now - row.usedAt.getTime() <= this.env.REFRESH_REUSE_GRACE_SECONDS * 1000) {
          return { kind: 'superseded' as const };
        }
        await this.revokeFamily(tx, row.familyId, row.userId, 'REFRESH_TOKEN_REUSE');
        return { kind: 'reused' as const, familyId: row.familyId };
      }
      if (row.expiresAt.getTime() <= now || row.familyExpiresAt.getTime() <= now) {
        return { kind: 'invalid' as const };
      }

      const [user] = await tx.select().from(users).where(eq(users.id, row.userId));
      if (!user) return { kind: 'invalid' as const };
      await tx
        .update(refreshTokens)
        .set({ usedAt: new Date(now) })
        .where(eq(refreshTokens.id, row.id));
      const refreshToken = await this.insert(tx, user.id, row.familyId, row.familyExpiresAt, now);
      return { kind: 'rotated' as const, user, refreshToken };
    });

    switch (outcome.kind) {
      case 'rotated':
        return { user: outcome.user, refreshToken: outcome.refreshToken };
      case 'superseded':
        throw new RefreshTokenSupersededError('this session was just refreshed; retry');
      case 'reused':
        // Committed above: the revocation must survive this error.
        this.logger.warn(
          { sessionId: outcome.familyId },
          'refresh token reuse detected; session revoked',
        );
        throw new InvalidRefreshTokenError('session revoked');
      default:
        throw new InvalidRefreshTokenError('invalid or expired session');
    }
  }

  /** True while the session has not been signed out or revoked. */
  async isActive(sessionId: string): Promise<boolean> {
    const now = Date.now();
    const cached = this.activeCache.get(sessionId);
    if (cached && (!cached.active || now - cached.checkedAt < this.env.SESSION_CHECK_CACHE_MS)) {
      return cached.active; // a revoked session never comes back, so "false" never goes stale
    }
    const [live] = await this.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.familyId, sessionId), isNull(refreshTokens.revokedAt)))
      .limit(1);
    this.remember(sessionId, live !== undefined, now);
    return live !== undefined;
  }

  /** Ends the session the token belongs to (sign-out). Unknown tokens are ignored. */
  async revoke(token: string): Promise<void> {
    await this.tx.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashToken(token)));
      if (row && !row.revokedAt) {
        await this.revokeFamily(tx, row.familyId, row.userId, 'SIGNED_OUT');
      }
    });
  }

  private async insert(
    tx: Transaction,
    userId: string,
    familyId: string,
    familyExpiresAt: Date,
    now: number,
  ): Promise<IssuedRefreshToken> {
    const token = newToken();
    const expiresAt = Math.min(
      now + this.env.REFRESH_TOKEN_TTL_SECONDS * 1000,
      familyExpiresAt.getTime(),
    );
    await tx.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash: hashToken(token),
      expiresAt: new Date(expiresAt),
      familyExpiresAt,
    });
    return { sessionId: familyId, token, maxAge: Math.floor((expiresAt - now) / 1000) };
  }

  private remember(sessionId: string, active: boolean, now: number) {
    if (this.activeCache.size >= 50_000) this.activeCache.clear(); // bounded memory
    this.activeCache.set(sessionId, { active, checkedAt: now });
  }

  private async revokeFamily(tx: Transaction, familyId: string, userId: string, reason: string) {
    // Mark it dead locally now; harmless if the transaction then rolls back (one extra sign-in).
    this.remember(familyId, false, Date.now());
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
    await this.events.emit(tx, {
      type: reason === 'SIGNED_OUT' ? 'UserSignedOut' : 'SessionRevoked',
      entityType: 'user',
      entityId: userId,
      data: { userId, sessionId: familyId, reason },
    });
  }
}
