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
