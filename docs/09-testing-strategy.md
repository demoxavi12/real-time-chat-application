# Testing Strategy

## Testing pyramid

### Backend unit tests

Test:

- validators
- services
- authorization rules
- utility functions

### Backend integration tests

Test:

- API + database
- authentication
- conversation access
- message persistence

### Socket integration tests

Use real Socket.IO client/server in test environment.

Test:

- authenticated connection
- invalid authentication
- room authorization
- message send/ack/broadcast
- private message isolation
- typing events
- read events
- reconnect behavior
- duplicate clientMessageId handling

### Frontend tests

Test:

- auth state
- message rendering
- error states
- composer behavior
- socket state transitions

### End-to-end browser tests

Use Playwright or an equivalent browser automation tool.

Critical flows:

1. Register user A.
2. Register user B.
3. Login A.
4. Login B in another browser context.
5. A sends public message.
6. B receives it without refresh.
7. A starts private conversation with B.
8. A sends private message.
9. B receives it.
10. Verify C cannot access A/B private conversation.
11. Refresh and verify message history.
12. Disconnect/reconnect and verify state resynchronization.

## Required negative tests

- Invalid credentials.
- Duplicate registration.
- Unauthorized message history.
- Unauthorized socket room join.
- Forged sender ID.
- Invalid message payload.
- Oversized message.
- Expired/invalid JWT.
- Rate-limit threshold.
- Database failure path.

## Coverage

Set thresholds after establishing a baseline, then increase them. Critical authorization and message flows must have explicit tests even if global coverage is high.

## Test commands

The actual package scripts must expose commands equivalent to:

```bash
npm run lint
npm run test
npm run test:integration
npm run test:e2e
npm run build
```

CI must run the appropriate subset automatically.

## Implemented tooling (Phase 0)

| Layer                   | Tooling                                                                             | Location                                        | Command                    |
| ----------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------- |
| Backend unit            | Vitest (`unit` project), Supertest against `createApp()` with injected dependencies | `apps/server/tests/unit`                        | `npm run test:unit`        |
| Frontend unit/component | Vitest + jsdom + Testing Library + jest-dom                                         | `apps/client/tests`                             | `npm run test:unit`        |
| Backend integration     | Vitest (`integration` project) + real in-memory MongoDB                             | `apps/server/tests/integration`                 | `npm run test:integration` |
| Socket.IO integration   | real `socket.io-client` against a real started server                               | `apps/server/tests/integration/socket.test.js`  | `npm run test:integration` |
| Process smoke           | spawns `src/index.js` as a child process                                            | `apps/server/tests/integration/process.test.js` | `npm run test:integration` |
| E2E                     | Playwright, Chromium desktop + Pixel 7 viewport                                     | `e2e/`                                          | `npm run test:e2e`         |

### Test database lifecycle

```text
Vitest globalSetup starts mongodb-memory-server (127.0.0.1, temp storage)
  -> each test file uses its own uniquely named database
  -> tests run
  -> globalSetup teardown stops mongod and deletes its storage
```

Nothing to create or clean manually. The MongoDB binary is downloaded once by
the `mongodb-memory-server` postinstall step and cached (in CI via
`actions/cache`). Tests that need an outage start their own dedicated instance
so they can stop it without affecting other files.

### E2E lifecycle

Playwright `webServer` entries start:

1. `scripts/e2e-backend.js` — an ephemeral MongoDB plus the real backend on
   port 5100, logging to `e2e-logs/backend.log`. Playwright polls `GET /ready`
   until it returns 200 (no sleeps).
2. A production client build (`vite build --outDir dist-e2e`) served by
   `vite preview` on port 4173, built with `VITE_API_URL=http://127.0.0.1:5100/api`
   so every browser request is cross-origin and CORS is exercised.

Both are stopped automatically after the run. Traces, screenshots and videos
are kept on failure.

### Current coverage of foundation behaviour

- `/health` and `/ready` (both prefixes), readiness with real MongoDB up,
  down after startup, hanging, and unreachable at boot.
- Env validation (missing/invalid values, test-DB loopback guard, no secret
  echo), logger redaction, error envelopes, validation middleware, JSON/body
  limits, 404, security headers, CORS allow/deny (REST and Socket.IO handshake),
  request ids, rate limiting (and probes exempt).
- Socket.IO connect/disconnect, polling transport, handshake middleware
  rejection, ack success/validation/AppError/internal-error paths, `error`
  event without ack, graceful shutdown behaviour.
- Server process: boots and becomes ready; exits 1 on missing config, on a
  non-local DB under test, and on an unreachable DB; SIGTERM → exit 0
  (Linux/CI only — POSIX signals cannot be delivered to child processes on
  Windows; the in-process `close()` path is tested on every platform).
- Client: config validation, HTTP client envelope/error mapping, socket client
  options, status page loading/healthy/unreachable/not-ready/re-check/abort.
- E2E: production bundle loads with no console errors and shows the live
  backend + database status; re-check works; no horizontal overflow on desktop
  and mobile.

Coverage thresholds are intentionally not set yet; a baseline is established
once feature code exists (Phase 1+).

### Authentication coverage (Phase 1)

Test data: `buildUserInput()` / `registerUser()` (server) and `uniqueUser()` /
`createUserViaApi()` (E2E) create obviously fake users on the reserved
`example.test` domain. Signing secrets are generated per run. Integration
suites use `startTestServer()` (own database on the ephemeral MongoDB) and
`craftToken()` to build expired, forged or otherwise hostile JWTs.

| Area             | Files                                           | What is proven                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Password hashing | `unit/password.test.js`                         | Argon2id + parameters, unique salts, verification, wrong/variant passwords, malformed hash, unicode, dummy-hash path                                                                                                                                                                                                                                                                                                                       |
| JWT              | `unit/token.test.js`                            | claims, unique sessions, payload contains no secrets/PII, expired, malformed, other secret, edited payload, `alg: none`, other algorithm, wrong issuer/audience, missing claims, session max age, sliding renewal and its cap                                                                                                                                                                                                              |
| Validation       | `unit/auth.validators.test.js`                  | email normalization, every field rule and bound, operator objects, server-owned fields rejected, error shape                                                                                                                                                                                                                                                                                                                               |
| Config           | `unit/authConfig.test.js`                       | secret required/length/placeholder, durations, cookie Secure rules, SameSite=None rule, no secret echo                                                                                                                                                                                                                                                                                                                                     |
| Middleware       | `unit/authMiddleware.test.js`                   | authenticate (cookie only, identity from session, clear on invalid, renewal), authorize (401/403/allow), Origin check, cookie attributes and `__Host-` prefix                                                                                                                                                                                                                                                                              |
| API              | `integration/auth.api.test.js`                  | register (success, safe fields, no hash/token in body, normalization, 409, concurrent duplicates, validation), login (success, case-insensitive email, lastSeenAt, wrong password, unknown email identical response, malformed/injection), me (valid, missing, malformed, expired, deleted/invalid user, sliding renewal), logout (revocation, renewed tokens revoked, TTL expiry stored, other sessions unaffected, idempotent, re-login) |
| Database         | `integration/user.model.test.js`                | unique + TTL indexes exist, stored Argon2id hash and exact stored fields, `select: false`, model-level normalization, strict schema, duplicate-key mapping                                                                                                                                                                                                                                                                                 |
| Security         | `integration/security.test.js`                  | forged ids (query/body/header), server-owned fields, edited/foreign/unsigned/stripped tokens, Bearer not accepted, no hash/token/secret/stack in any response, nothing sensitive in logs, HttpOnly, 413 and password bound, CORS, cross-origin register/logout blocked, login/register rate limits, probes and `/me` not throttled                                                                                                         |
| Socket.IO        | `integration/socket.auth.test.js`               | handshake requires session, identity from cookie only (forged `auth`/query ignored), token outside cookie rejected, malformed/forged/expired/revoked/deleted-user rejected, foreign Origin refused                                                                                                                                                                                                                                         |
| Frontend         | `client/tests/auth.test.jsx`, `authApi.test.js` | session restore, loading/error/retry, guards and redirects, open-redirect protection, login/register validation, loading, error messages, success, logout success/failure, no password in console, API request shapes                                                                                                                                                                                                                      |
| E2E              | `e2e/auth.spec.js` (desktop + mobile)           | registration, login, invalid login, reload persistence, logout incl. server-side revocation of the old token, protected-route redirect and return, user isolation (two browser contexts), layout                                                                                                                                                                                                                                           |

Phase 0 suites were kept: the status page tests now run on the public
`/status` route, and the Socket.IO suite connects as a registered user because
every socket must authenticate.

### Conversation and message coverage (Phase 2)

Helpers: `signedInUser()` (server, registered user with `get`/`post`,
`openPrivateWith`, `send`), `publicRoomId()`, `fakeChatApi()` (client) and
`createUserViaApi()` / `uniqueUser()` (E2E). Edge-case data (identical
timestamps, deleted senders/cursor messages) is written directly to the test
database.

| Area              | Files                                           | What is proven                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cursors & paging  | `unit/pagination.test.js`                       | round-trips, conversation-bound message cursors, wrong kind, malformed/tampered/operator payloads, `limit + 1` page edges (0, fewer, exact, more)                                                                                                                                                                                                                                                                                          |
| Validation        | `unit/conversation.validators.test.js`          | ids, content trim/normalize/bounds (2000 vs 2001)/control characters, server-owned fields rejected, clientMessageId, limits, unknown query fields, search bounds                                                                                                                                                                                                                                                                           |
| Model & rules     | `unit/conversation.test.js`                     | private-pair key symmetry, schema invariants (two distinct participants, matching key, public has none, strict), access rule, 404-for-both, self/unknown user, policy uses `req.auth`, public shapes expose no internals, regex escaping                                                                                                                                                                                                   |
| Conversations API | `integration/conversations.api.test.js`         | public room singleton (incl. concurrent ensure), private open 201/200 both directions, **12 concurrent opens from both users → one conversation**, self/unknown/malformed/extra fields, listing visibility and activity order, cursor paging without gaps, invalid cursor, 401 on every route                                                                                                                                              |
| Messages API      | `integration/messages.api.test.js`              | send shape, sender from session, `readBy`, activity update, public room posting, markup stored verbatim, length bounds, invalid bodies store nothing, `clientMessageId` idempotency (sequential and **8 concurrent**), per-sender scope, history: empty, fewer, exact page, many pages (gapless, ordered), **identical timestamps across page sizes 1–10**, deleted cursor message, foreign/malformed cursors, page bounds, deleted sender |
| Users API         | `integration/users.api.test.js`                 | id+name only, self excluded, prefix search, exact email search without leaking emails, regex metacharacters literal, cursor paging, input bounds/injection                                                                                                                                                                                                                                                                                 |
| Database          | `integration/chat.database.test.js`             | every index with its unique/partial options, `explain()` shows IXSCAN for history and listing, direct duplicate private/public inserts rejected by MongoDB, forced duplicate-key race path returns the winner, 20 concurrent repository opens → one, server-side timestamps                                                                                                                                                                |
| Security          | `integration/chat.security.test.js`             | IDOR (read, history, post, cursor reuse), guessed vs real foreign ids indistinguishable, list isolation, forged senderId, smuggled identity, opening on behalf of others, membership changes impossible (no routes; participants unchanged), malformed/operator ids and queries, 413, CSRF Origin check, no emails/hashes/privateKey/readBy in payloads                                                                                    |
| Frontend          | `client/tests/chat.test.jsx`, `chatApi.test.js` | list (loading, empty, error/retry, more), discovery → open → navigate, no-result/blank/error search, history order and sender, empty, load older, refresh dedup, not found, text-only rendering, send (trim, id, clear, list reorder), validation, draft kept + same `clientMessageId` on retry, Enter/Shift+Enter, sending state, deep-link protection; API URL/encoding and model helpers                                                |
| E2E               | `e2e/chat.spec.js` (desktop + mobile)           | A discovers B → private conversation → message; B sees it and replies; A refreshes/reloads and sees ordered history; reopening reuses the conversation; C cannot see or open it (UI and API 404); public room shared; XSS payload shown literally (no dialog); layout fits                                                                                                                                                                 |
