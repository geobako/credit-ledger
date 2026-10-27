import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { Principal, Role } from './principal';

export const IS_PUBLIC = 'auth:public';
export const ROLES = 'auth:roles';

/** Opts a route out of authentication (it is required by default). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts a route to the given roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const SIGN_IN_RATE_LIMITED = 'auth:sign-in-rate-limited';
/** Puts an endpoint in the strict sign-in rate-limit bucket (see the `auth` throttler). */
export const SignInRateLimited = () => SetMetadata(SIGN_IN_RATE_LIMITED, true);

export type AuthenticatedRequest = Request & { principal?: Principal };

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const principal = ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal;
  if (!principal) throw new Error('CurrentPrincipal used on a public route');
  return principal;
});
