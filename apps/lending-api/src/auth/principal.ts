export type Role = 'customer' | 'ops';

/** The authenticated caller, derived only from a verified token. */
export interface Principal {
  userId: string;
  email: string;
  role: Role;
  /** The sign-in session this token belongs to; revoked sessions are rejected at once. */
  sessionId: string;
}

export const isOps = (principal: Principal) => principal.role === 'ops';
