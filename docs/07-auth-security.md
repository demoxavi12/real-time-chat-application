# Authentication & Security Design

## Implementation (Phase 1)

What is implemented and tested today. The sections after this one are the
original design requirements; this section records how they were met.

### Flow

```text
POST /api/auth/register|login
  -> validate (zod, strict) -> authService -> userRepository -> MongoDB
  <- 2xx { user } + Set-Cookie: rtc_session=<JWT>; HttpOnly; SameSite=Lax; Path=/; [Secure]

GET /api/auth/me (any protected route)
  -> authenticate middleware: read cookie -> verify JWT -> load user
     -> check session not revoked -> req.auth = { user, userId, sessionId }
     -> (sliding renewal) -> [authorize(policy)] -> controller

Socket.IO handshake -> same cookie -> same authService.authenticate()
  -> socket.data.auth = { userId, sessionId, name }
```

### Passwords

- Argon2id (`argon2` package), OWASP baseline parameters m = 19 MiB, t = 2,
  p = 1, unique salt per hash, stored as a PHC string (parameters can be raised
  later without invalidating existing hashes).
- Policy: 8–128 characters, no composition rules (NIST SP 800-63B); the
  maximum bounds hashing cost. Passwords are not trimmed.
- `passwordHash` has `select: false` and the API only ever returns the
  explicit public user shape (`id`, `name`, `email`, `createdAt`).
- Login with an unknown email still runs an Argon2 verification against a
  dummy hash and returns the same `401 INVALID_CREDENTIALS` body as a wrong
  password, so neither content nor timing reveals which emails exist.
- Registration with an existing email returns `409 EMAIL_ALREADY_EXISTS`
  (required by the product spec). This does reveal that an account exists;
  it is mitigated by the registration rate limit.

### Tokens and sessions

- HS256 JWT signed with `JWT_SECRET` (≥ 32 characters, required; the
  `.env.example` placeholder is rejected at startup). Verification pins the
  algorithm, issuer (`realtime-chat-api`) and audience
  (`realtime-chat-client`) and requires `sub`, `sid`, `auth_time`, `iat`,
  `exp`. `alg: none`, other algorithms, other secrets and edited payloads are
  rejected.
- Claims carry only ids and times (`sub` = user id, `sid` = random session id,
  `auth_time` = sign-in time). No email, name, roles or secrets.
- Token lifetime `JWT_EXPIRES_IN` (default 1 h) acts as an idle timeout. When
  less than half of it remains, any authenticated request receives a renewed
  token for the same session (sliding session), never beyond
  `SESSION_MAX_AGE` (default 7 d) after sign-in; older sessions are rejected
  even if a token claims a later `exp`.
- Every authenticated request (REST and Socket.IO handshake) re-checks that
  the user still exists and that the session id is not revoked. This costs two
  indexed lookups per request and removes the classic stateless-JWT gap.
- **Logout** stores the session id in `revokedsessions` until the session's
  absolute end (TTL index deletes it afterwards) and clears the cookie. All
  tokens of that session — including renewed ones and copies an attacker may
  hold — stop working immediately. Other sessions (devices) of the same user
  stay valid. A "sign out everywhere" action does not exist yet.

### Cookie strategy (threat model)

The JWT travels only in a cookie, never in a response body, `localStorage` or
`sessionStorage`:

| Threat                         | Mitigation                                                                                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XSS reads the token            | `HttpOnly`: page scripts cannot read it (verified in E2E).                                                                                                                                                                         |
| Token sent over plain HTTP     | `Secure` (default in production; `AUTH_COOKIE_SECURE=false` is rejected in production). With Secure the `__Host-` prefix forces `Path=/`, no `Domain`.                                                                             |
| CSRF (cookies are ambient)     | `SameSite=Lax` (default; `none` requires Secure) **and** an Origin check: `POST`/`PUT`/`PATCH`/`DELETE` under `/api` with an `Origin` outside `CLIENT_ORIGIN` → `403 ORIGIN_NOT_ALLOWED`. JSON bodies also force a CORS preflight. |
| Cross-site WebSocket hijacking | Socket.IO `allowRequest` rejects handshakes/upgrades whose `Origin` is not an allowed client origin.                                                                                                                               |
| Cross-origin reads             | CORS allows credentials only for `CLIENT_ORIGIN` origins.                                                                                                                                                                          |
| Stolen token replay            | Short idle lifetime, absolute session cap, server-side revocation on logout.                                                                                                                                                       |

In development (`http://localhost`) cookies are not Secure. The client and API
are same-site in all supported setups (Vite proxy, reverse proxy, or E2E on
`127.0.0.1` with different ports), so `SameSite=Lax` works. A deployment on
different sites would need `AUTH_COOKIE_SAMESITE=none` + Secure.

### Authorization foundation

`authorize(policy)` middleware: `authenticate -> authorize(policy) ->
controller`. The policy receives `req` and must decide from `req.auth` (the
verified identity) and route params, never from client-supplied identity
fields. It returns `403 FORBIDDEN` when the policy fails and `401` if
authentication did not run. Conversation-membership policies arrive in
Phase 2.

### Rate limiting

- General `/api` limit (Phase 0).
- `POST /api/auth/login`: `AUTH_RATE_LIMIT_MAX` failed attempts per IP per
  `AUTH_RATE_LIMIT_WINDOW_MS` (default 10 / 15 min); successful logins do not
  count, and once throttled even correct credentials get `429` until the window
  resets.
- `POST /api/auth/register`: every attempt counts (same defaults).
- Limits are per IP. `TRUST_PROXY` (default `0`) sets how many reverse-proxy
  hops are trusted: with `0`, `X-Forwarded-For` is ignored, so clients cannot
  spoof their IP to escape limits; behind N proxies set it to exactly N so the
  REST limiters and the socket connection limiter see the real client IP
  (both use the same rule; integration-tested).

### Validation and errors

Strict zod schemas (unknown keys such as `_id`, `passwordHash`, `createdAt`,
`userId` are rejected), email normalization (trim + lower-case) in the
validator and the model, control characters rejected in names, MongoDB
operator objects rejected (`{ "$ne": null }` is not a string). Stable error
codes: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `AUTHENTICATION_REQUIRED`,
`AUTHENTICATION_INVALID`, `EMAIL_ALREADY_EXISTS`, `FORBIDDEN`,
`ORIGIN_NOT_ALLOWED`, `RATE_LIMITED`. Unexpected errors are logged with the
request id and returned as a generic `INTERNAL_ERROR`.

### Logging

Request logs record method, path, status, duration and request id only.
Auth flows log nothing else; the logger additionally redacts keys such as
`password`, `token`, `secret`, `cookie`, `authorization`. An integration test
asserts that passwords, tokens, the signing secret and user emails never
appear in log output.

### Real-time security (Phase 3)

- Sockets authenticate with the same cookie/service as REST; logout
  disconnects the session's sockets and every socket is closed at the
  session's absolute end, so a revoked or expired session cannot keep a
  connection.
- Every room/event is authorized server-side with the REST access rule;
  client-supplied identity or "authorized" flags are rejected by strict
  schemas. Private messages go only to the conversation room and private
  conversation metadata only to its participants' user rooms.
- Messages are persisted before any broadcast; failures broadcast nothing.
- Abuse limits: connection attempts per IP, events and sends per socket,
  disconnect after floods of invalid/unknown events, 100 KB packet cap.
- Socket logs contain socket ids, user ids and event names only — never message
  content, cookies or tokens.

### Production hardening (Phase 6)

- Configuration is validated at startup and production refuses unsafe
  values: `CLIENT_ORIGIN` must be `https://`, `AUTH_COOKIE_SECURE=false` is
  rejected (the cookie becomes `__Host-rtc_session`), the `.env.example`
  JWT placeholder and short secrets are rejected.
- `npm audit` reports 0 vulnerabilities; `npm run security` (audit at
  `high` + secret scan) is part of `npm run verify` and CI.
- Read state exposes only a derived `seen` boolean in private
  conversations; `readBy` (who read what) is never returned.
- Conversation previews are plain text, bounded to 120 characters and
  rendered as text by React (never as HTML).
- Client: on any `401` from a data request the session is re-checked and
  the user is returned to sign-in with a "session has ended" notice; no
  token is ever readable by JavaScript (HttpOnly cookie).

### Known limitations

- Sessions are revoked one at a time; there is no "sign out all devices" or
  password change/reset flow yet.
- No account lockout beyond IP rate limiting (deliberately, to avoid
  lockout-based denial of service).
- Email addresses are not verified.
- A socket whose user account is deleted while connected stays connected
  until it disconnects (new handshakes are refused).

## Authentication

Use JWT-based authentication.

Preferred browser strategy:

- Short-lived access token.
- Secure, HttpOnly, SameSite cookie where compatible with the deployment architecture.
- Do not place long-lived secrets in localStorage by default.
- If a different strategy is selected, document the threat model and reason.

## Passwords

- Hash using a modern password hashing algorithm such as Argon2id or bcrypt with an appropriate cost.
- Never log passwords.
- Never return password hashes.
- Enforce password length requirements.
- Consider generic login failure messages to reduce account enumeration.

## Authorization

Every protected operation must answer:

1. Who is the authenticated user?
2. What resource is being accessed?
3. Is this user allowed to access it?

Private conversation authorization is mandatory for both REST and Socket.IO.

## Input security

- Validate body/query/path/socket payloads.
- Bound message size.
- Sanitize/escape output as appropriate to prevent XSS.
- Never execute user-provided HTML/scripts.
- Reject malformed ObjectIds/IDs before database calls.

## HTTP security

Use appropriate middleware for:

- Helmet/security headers.
- CORS with explicit allowed origins.
- Rate limiting.
- Request size limits.
- Safe JSON parsing.

## Socket security

- Authenticate during handshake.
- Apply per-event validation.
- Rate-limit high-frequency events.
- Avoid accepting arbitrary room joins.
- Never let a client choose an identity.

## Database security

- Use environment variables for credentials.
- Least-privilege database user.
- Validate schemas.
- Add indexes deliberately.
- Avoid returning unrestricted documents.

## Secrets

Never commit:

```text
.env
.env.local
JWT secrets
MongoDB credentials
API keys
private keys
test credentials
```

Provide `.env.example` with placeholders only.

## Logging

Logs may contain:

- request ID
- route
- status
- latency
- event name
- non-sensitive user identifier where justified

Logs must not contain:

- passwords
- JWTs
- cookies
- authorization headers
- database credentials
- full private message bodies by default

## Security testing

Automate checks for:

- unauthorized REST access
- unauthorized private conversation access
- invalid socket token
- forged sender identity
- malformed payloads
- oversized messages
- rate-limit behavior
- XSS payload handling
- CORS configuration
