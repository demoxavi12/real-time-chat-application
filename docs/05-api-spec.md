# REST API Contract

Base path:

```text
/api
```

## Implementation status

| Endpoint group                       | Status                                        |
| ------------------------------------ | --------------------------------------------- |
| Health (`/health`, `/ready`)         | **Implemented (Phase 0)**, integration-tested |
| Auth, Users, Conversations, Messages | Specified below; not implemented yet          |

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

| HTTP | Code                | When                                      |
| ---- | ------------------- | ----------------------------------------- |
| 400  | `VALIDATION_ERROR`  | Request params/query/body fail validation |
| 400  | `INVALID_JSON`      | Body is not valid JSON                    |
| 404  | `NOT_FOUND`         | No such route                             |
| 413  | `PAYLOAD_TOO_LARGE` | JSON body over 100 KB                     |
| 429  | `RATE_LIMITED`      | API rate limit exceeded                   |
| 500  | `INTERNAL_ERROR`    | Any unexpected error (details hidden)     |
| 503  | `NOT_READY`         | `/ready` when a dependency is down        |

## Auth

### POST /auth/register

Request:

```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "password": "strong-password"
}
```

### POST /auth/login

Request:

```json
{
  "email": "alice@example.com",
  "password": "strong-password"
}
```

### POST /auth/logout

Invalidates the applicable session/token strategy.

### GET /auth/me

Returns the authenticated user.

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
