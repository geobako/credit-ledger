import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { ENV, Env } from '../config/env';
import { UnauthenticatedError } from './auth.errors';
import { Principal, Role } from './principal';

const ISSUER = 'acme-credit-idp';
const AUDIENCE = 'lending-api';
const ALGORITHM = 'ES256';

interface Claims {
  sub: string;
  email: string;
  role: Role;
}

/**
 * Stands in for an external identity provider (Cognito, Auth0, ...). Issuing lives here only
 * because there is no real IdP; verification uses the public key alone, exactly as it would
 * against a provider's JWKS. Pinning algorithm, issuer and audience blocks alg-confusion
 * and token-substitution attacks.
 */
@Injectable()
export class TokenService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  issue(principal: Principal): { accessToken: string; expiresIn: number } {
    const claims: Claims = { sub: principal.userId, email: principal.email, role: principal.role };
    const accessToken = jwt.sign(claims, this.env.JWT_PRIVATE_KEY, {
      algorithm: ALGORITHM,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.env.JWT_TTL_SECONDS,
    });
    return { accessToken, expiresIn: this.env.JWT_TTL_SECONDS };
  }

  verify(token: string): Principal {
    try {
      const claims = jwt.verify(token, this.env.JWT_PUBLIC_KEY, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience: AUDIENCE,
      }) as Partial<Claims>;
      if (!claims.sub || !claims.email || (claims.role !== 'customer' && claims.role !== 'ops')) {
        throw new Error('malformed claims');
      }
      return { userId: claims.sub, email: claims.email, role: claims.role };
    } catch {
      throw new UnauthenticatedError('invalid or expired access token');
    }
  }
}
