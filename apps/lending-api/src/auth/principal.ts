export type Role = 'customer' | 'ops';

/** The authenticated caller, derived only from a verified token. */
export interface Principal {
  userId: string;
  email: string;
  role: Role;
}

export const isOps = (principal: Principal) => principal.role === 'ops';
