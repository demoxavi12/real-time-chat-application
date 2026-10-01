# REST API Contract

Base path:

```text
/api
```

## Implementation status

| Endpoint group                 | Status                                                          |
| ------------------------------ | --------------------------------------------------------------- |
| Health (`/health`, `/ready`)   | **Implemented (Phase 0)**, integration-tested                   |
| Auth (`/api/auth/*`)           | **Implemented (Phase 1)**, unit/integration/security/E2E-tested |
| Users, Conversations, Messages | Specified below; not implemented yet                            |

Cross-cutting behaviour that is already implemented for every route:

- **Envelope:** all responses use the standard envelope below.
- **Security headers:** Helmet defaults (CSP, HSTS, `nosniff`, frame options); `X-Powered-By` removed.
- **CORS:** only origins listed in `CLIENT_ORIGIN`, with credentials.
- **Body limit:** JSON bodies over 100 KB → `413 PAYLOAD_TOO_LARGE`; malformed JSON → `400 INVALID_JSON`.
- **Rate limiting:** every `/api/*` route except the probes is limited per IP
  (`RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS`) → `429 RATE_LIMITED`, with `RateLimit`/`RateLimit-Policy` headers.
- **Request id:** every response carries `X-Request-Id` (a well-formed inbound value is reused).
- **Unknown routes:** `404 NOT_FOUND`.
- **Unexpected errors:** `500 INTERNAL_ERROR` with a generic message. Stack traces and internal messages are never returned (in any environment); they are logged server-side with the request id.
- **Validation:** `validate({ params, query, body })` middleware (zod schemas) → `400 VALIDATION_ERROR` with `details: [{ path, message }]`.

## Health

The probes are served at the server root (for load balancers/orchestrators)
**and** under `/api` (for the client's API base URL). They are never rate
limited and respond with `Cache-Control: no-store`.

### GET /health (also GET /api/health)

Liveness: the process is up and serving HTTP. Does **not** check dependencies.

`200 OK`

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "uptimeSeconds": 42,
    "timestamp": "2026-09-30T12:00:00.000Z"
  }
}
```

### GET /ready (also GET /api/ready)

Readiness: every required dependency is reachable **now**. The database check
is a real MongoDB `ping` with a timeout (not a cached connection flag), so an
outage after startup is reported.

`200 OK`

```json
{
  "success": true,
  "data": { "status": "ready", "checks": { "database": "up" } }
}
```

`503 Service Unavailable`

```json
{
  "success": false,
  "error": {
    "code": "NOT_READY",
    "message": "Service is not ready",
    "details": [{ "check": "database", "status": "down" }]
  }
}
```

Dependency error messages (host names, driver errors) are never included.

## Error codes (implemented)

| HTTP | Code                      | When                                                     |
| ---- | ------------------------- | -------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`        | Request params/query/body fail validation                |
| 400  | `INVALID_JSON`            | Body is not valid JSON                                   |
| 401  | `AUTHENTICATION_REQUIRED` | Protected route without a session cookie                 |
| 401  | `AUTHENTICATION_INVALID`  | Token invalid/expired/revoked, or user no longer exists  |
| 401  | `INVALID_CREDENTIALS`     | Login failed (same for unknown email and wrong password) |
| 403  | `FORBIDDEN`               | Authenticated but an `authorize()` policy denied it      |
| 403  | `ORIGIN_NOT_ALLOWED`      | Unsafe method with a foreign `Origin` header             |
| 404  | `NOT_FOUND`               | No such route                                            |
| 409  | `EMAIL_ALREADY_EXISTS`    | Registration with an existing email                      |
| 413  | `PAYLOAD_TOO_LARGE`       | JSON body over 100 KB                                    |
| 429  | `RATE_LIMITED`            | API rate limit exceeded                                  |
| 500  | `INTERNAL_ERROR`          | Any unexpected error (details hidden)                    |
| 503  | `NOT_READY`               | `/ready` when a dependency is down                       |

## Auth (implemented — Phase 1)

All auth routes live under `/api/auth`, respond with `Cache-Control: no-store`,
and use the standard envelope. The session is an **HttpOnly cookie**
(`rtc_session`; `__Host-rtc_session` when Secure) holding a signed JWT; the
token never appears in a response body. Browsers must send requests with
credentials (`fetch(..., { credentials: 'include' })`).

State-changing requests (`POST`) that carry an `Origin` header must come from a
`CLIENT_ORIGIN` origin, otherwise `403 ORIGIN_NOT_ALLOWED` (CSRF defence).

Request bodies are strict: unknown fields (e.g. `_id`, `passwordHash`,
`createdAt`, `userId`) are rejected with `400 VALIDATION_ERROR`.

Public user shape (the only user representation the API returns):

```json
{
  "id": "65f0c1...",
  "name": "Alice",
  "email": "alice@example.com",
  "createdAt": "2026-10-01T12:00:00.000Z"
}
```

### POST /api/auth/register

Request:

```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "password": "strong-password"
}
```

Rules: `name` trimmed, 1–50 characters, no control characters; `email` trimmed
and lower-cased, valid format, ≤ 254 characters; `password` 8–128 characters
(no composition rules, not trimmed).

| Status | Body                                         | Notes                   |
| ------ | -------------------------------------------- | ----------------------- |
| 201    | `{ "success": true, "data": { "user": … } }` | Sets the session cookie |
| 400    | `VALIDATION_ERROR` with `details[]`          | No cookie               |
| 409    | `EMAIL_ALREADY_EXISTS`                       | No cookie               |
| 429    | `RATE_LIMITED`                               | Every attempt counts    |

### POST /api/auth/login

Request:

```json
{
  "email": "alice@example.com",
  "password": "strong-password"
}
```

| Status | Body                                                     | Notes                                                             |
| ------ | -------------------------------------------------------- | ----------------------------------------------------------------- |
| 200    | `{ "success": true, "data": { "user": … } }`             | New session; sets the cookie; updates `lastSeenAt`                |
| 400    | `VALIDATION_ERROR`                                       | Malformed request                                                 |
| 401    | `INVALID_CREDENTIALS` — "Email or password is incorrect" | Identical for unknown email and wrong password (timing equalized) |
| 429    | `RATE_LIMITED`                                           | Only failed attempts count                                        |

### GET /api/auth/me

Requires the session cookie.

| Status | Body                                         | Notes                                                                                       |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 200    | `{ "success": true, "data": { "user": … } }` | May set a renewed cookie (sliding session)                                                  |
| 401    | `AUTHENTICATION_REQUIRED`                    | No cookie                                                                                   |
| 401    | `AUTHENTICATION_INVALID`                     | Malformed/forged/expired/revoked token, or the user no longer exists; the cookie is cleared |

Identity comes only from the verified token: query/body/header user ids are
ignored, and `Authorization: Bearer` is not accepted.

### POST /api/auth/logout

Idempotent. If a valid session cookie is presented, that session is revoked
server-side (every token of the session, including renewed ones, stops working
immediately); the cookie is always cleared. Other sessions of the same user
(other devices) are unaffected.

`200 OK` → `{ "success": true, "data": { "loggedOut": true } }`

### Rate limits

`POST /register` and `POST /login` each have a per-IP limit of
`AUTH_RATE_LIMIT_MAX` requests per `AUTH_RATE_LIMIT_WINDOW_MS` (default 10 per
15 minutes); for login only failed attempts count. This is in addition to the
general `/api` limit. `GET /me`, logout and the health probes are not
auth-rate-limited.

## Users

### GET /users

Authenticated user search/list with bounded pagination.

Do not expose sensitive account fields.

## Conversations

### GET /conversations

Returns conversations visible to the authenticated user.

### POST /conversations/private

Request:

```json
{
  "userId": "<target-user-id>"
}
```

Server must derive the requester from authentication.

### GET /conversations/:conversationId

Returns authorized conversation metadata.

## Messages

### GET /conversations/:conversationId/messages

Query:

```text
limit=30
before=<cursor>
```

Server must verify conversation membership.

## Standard response envelope

Success example:

```json
{
  "success": true,
  "data": {}
}
```

Error example:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": []
  }
}
```

## API rules

- Validate request body/query/params.
- Authenticate protected routes.
- Authorize resource ownership/membership.
- Never trust client-provided sender IDs.
- Never expose stack traces in production.
- Keep error codes stable enough for frontend handling.
