import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { Principal, Role } from './principal';

export const IS_PUBLIC = 'auth:public';
export const ROLES = 'auth:roles';

/** Opts a route out of authentication (it is required by default). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts a route to the given roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export type AuthenticatedRequest = Request & { principal?: Principal };

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const principal = ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal;
  if (!principal) throw new Error('CurrentPrincipal used on a public route');
  return principal;
});
