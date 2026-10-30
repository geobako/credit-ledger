# 0008: Sessions with short-lived access tokens and rotating refresh tokens

**Status:** accepted (replaces passwordless demo sign-in)

## Context

Customers need to stay signed in across reloads without a long-lived credential that a script
in the page could steal. The first version kept a 1-hour access token in `sessionStorage`:
simple, but readable by any injected script, impossible to revoke, and lost when the tab
closed.

## Decision

- **Sign-in** with email and password. Passwords are hashed with **scrypt**
  (N=2^15, r=8, p=1; parameters stored with each hash so the cost can rise later).
  - Unknown emails and wrong passwords get the same error and the same timing: a dummy hash
    is verified when the user doesn't exist.
  - Rate limited (10 per minute per IP), plus a WAF rule at the edge.
- **Access token:** an ES256 JWT valid for **15 minutes**, returned in the response body and
  kept **only in memory** by the web app.
- **Refresh token:** 256 random bits, sent as an `httpOnly`, `SameSite=Strict` cookie scoped to
  `/api/v1/auth` (`Secure` in production). Only its SHA-256 is stored.
- **Rotation.** Every refresh consumes the token and issues a new one in the same _family_
  (session):
  - **7-day sliding expiry** and **30-day absolute expiry**.
  - **Reuse detection:** a consumed token presented again means someone kept a copy, so the
    whole family is revoked and audited as `SessionRevoked`. Both the thief and the victim
    must sign in again.
  - **Grace window (10 s):** a just-consumed token presented again gets
    `REFRESH_TOKEN_SUPERSEDED` instead. That is two tabs refreshing at once, not theft; the
    client retries with the cookie the first response set.
- **CSRF.** Only `/auth/refresh` and `/auth/logout` read the cookie. Besides `SameSite=Strict`,
  they require an `X-CSRF-Protection` header, which other origins can't send without passing a
  CORS preflight.
- **Sign-out** revokes the family server-side and clears the cookie.
- **Web client:**
  - on load, it restores the session by calling refresh;
  - it refreshes a minute before expiry;
  - a request that gets 401 refreshes **once** (single-flight across concurrent requests) and
    replays. That is safe for writes, which carry idempotency keys.
- Sign-ins, sign-outs and revocations are written to the audit log (ids only, no personal data).

## Consequences

- No long-lived credential is reachable from JavaScript; a stolen refresh token is detected the
  next time either party uses it.
- Sessions survive reloads and new tabs, and can be revoked.
- **Amended:** access tokens carry the session id (`sid`), and the auth guard rejects tokens of
  signed-out or revoked sessions. To avoid a database read per request, each replica caches
  "still active" for 5 seconds (an indexed lookup on `family_id`). Revocation is immediate on
  the replica that performs it and takes effect within 5 seconds on the others. Before this,
  a signed-out session's access token kept working for up to 15 minutes.
- A refresh-token table to maintain. Expired rows need a periodic purge (follow-up), and the
  `family_id` index keeps revocation cheap.

## Alternatives considered

- **Long-lived JWT in localStorage.** Readable by XSS, not revocable.
- **Server-side session id cookie for every request (classic sessions).** It is simple and
  revocable, but every API call becomes cookie-authenticated (CSRF surface on all endpoints)
  and needs a session lookup. Bearer access tokens keep the API usable by non-browser clients
  too.
- **Backend-for-frontend holding the tokens.** This is the strongest option for browsers, but
  it adds a component. Worth it with a real external IdP.
- **External IdP (Cognito, Auth0).** It is the production answer; this design mirrors what
  they provide (short access tokens, rotating refresh tokens with reuse detection).
