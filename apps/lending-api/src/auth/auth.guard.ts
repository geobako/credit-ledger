import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContext } from '../common/context/request-context';
import { ForbiddenError } from '../common/errors/domain-error';
import { UnauthenticatedError } from './auth.errors';
import { AuthenticatedRequest, IS_PUBLIC, ROLES } from './decorators';
import { Role } from './principal';
import { SessionsService } from './sessions.service';
import { TokenService } from './token.service';

/** Global guard: every route needs a valid bearer token unless marked @Public(). Deny by default. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthenticatedError('a bearer token is required');
    }
    req.principal = this.tokens.verify(token);
    // Signed-out or revoked sessions die immediately, not when their access token expires.
    if (!(await this.sessions.isActive(req.principal.sessionId))) {
      throw new UnauthenticatedError('this session has ended');
    }
    RequestContext.setActor({ type: 'user', id: req.principal.userId, role: req.principal.role });

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(req.principal.role)) {
      throw new ForbiddenError('this operation is not available to your role');
    }
    return true;
  }
}
