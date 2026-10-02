# Real-Time Chat Application

A full-stack real-time messaging platform built with React, Node.js,
Express.js, MongoDB, Socket.IO and JWT.

> **Status: Phase 3 — real-time messaging complete.** Users can register,
> find each other, chat privately or in the public room, and see messages,
> typing, read receipts and presence live over Socket.IO, with MongoDB as the
> durable source of truth. Not implemented yet: file sharing, notifications,
> deployment. See the [roadmap](#roadmap).

## What exists today

- **Real-time messaging** (Phase 3, Socket.IO)
  - authenticated sockets (same HttpOnly session as REST); logout and session
    end disconnect live sockets
  - `conversation:join`/`leave` with server-side authorization
  - `message:send` persisted **before** acknowledgement and `message:new`
    broadcast to the conversation room; retries deduplicated by
    `clientMessageId` (shared with REST); failed writes broadcast nothing
  - live conversation list (`conversation:update`), typing indicators, read
    receipts (private conversations), online/offline presence
  - multiple tabs/devices per user; automatic reconnect with room rejoin and
    REST resync; per-IP and per-socket rate limits
- **Conversations and messages** (Phase 2, REST)
  - `GET /api/users`: directory and search (name prefix or exact email), returns
    only id and name, cursor-paginated
  - public room "General" (one, for everyone) and private 1-to-1
    conversations; opening a private conversation is idempotent and creates
    exactly one per pair, even under concurrent requests (unique index)
  - `GET /api/conversations`, `POST /api/conversations/private`,
    `GET /api/conversations/:id`
  - `GET /api/conversations/:id/messages` (cursor pagination, stable ordering)
    and `POST /api/conversations/:id/messages` (sender from the session,
    retry-safe with `clientMessageId`)
  - server-side membership authorization on every route; non-members get the
    same 404 as for unknown ids
  - minimal chat UI: conversation list, user search, history with
    "Load older messages", composer

- **Authentication** (Phase 1)
  - `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`,
    `POST /api/auth/logout`
  - Argon2id password hashing; generic login errors with equalized timing
  - JWT session in an **HttpOnly, SameSite** cookie (Secure in production);
    the token is never exposed to JavaScript
  - sliding sessions (idle timeout + absolute maximum) and **server-side
    revocation on logout**
  - reusable `authenticate` and `authorize(policy)` middleware; identity always
    comes from the verified session, never from request data
  - CSRF defence (SameSite + Origin check), stricter rate limits on login and
    registration
  - Socket.IO handshake authentication with the same session
  - login, registration and protected app shell in the React client
- **Backend** (`apps/server`): Express 5 + Socket.IO 4 + Mongoose 9
  - validated environment configuration that fails fast with clear messages
  - MongoDB connection abstraction with graceful shutdown; indexes ensured at startup
  - `GET /health` (liveness) and `GET /ready` (live MongoDB ping), also under `/api`
  - Helmet security headers, CORS allow-list, 100 KB body limit, per-IP API rate limiting
  - standard `{ success, data | error }` envelope, centralized error handling
    (no stack traces or internal messages in responses), zod request validation
  - Socket.IO server with authenticated handshakes, a handler registry,
    centralized event error handling and graceful shutdown
  - structured JSON logging with automatic redaction of secrets
- **Frontend** (`apps/client`): React 19 + Vite 8 + React Router
  - validated `VITE_*` configuration (defaults to same-origin)
  - REST client boundary (envelope-aware) and Socket.IO client boundary (not connected yet)
  - routes: `/` and `/conversations/:id` (protected chat), `/login`, `/register`,
    `/status` (public system status)
- **Automation**: Prettier, ESLint, Vitest (unit, integration, Socket.IO),
  Playwright E2E, npm audit, secret scan, `npm run verify`, GitHub Actions CI

## Architecture

```text
React client (Vite) ── REST /api ──► Express ── services ──► MongoDB
        └──────────── Socket.IO ───► Socket gateway (same HTTP server)
```

Details: [docs/03-architecture.md](docs/03-architecture.md) (section 7
describes what is implemented), [repository structure](docs/15-repository-structure.md),
[decision log](docs/16-decision-log.md).

## Prerequisites

- Node.js `^20.19` or `>=22.12` (`.nvmrc` pins 22) and npm
- A MongoDB instance **for local development only** (local `mongod`, Docker, or
  Atlas). Automated tests do not need one — they start their own.

## Setup

```bash
npm install
```

`npm install` also downloads the MongoDB binary used by the tests (once, cached).

```bash
npx playwright install chromium
```

This one-time step downloads the browser used by the E2E tests.

```bash
cp .env.example .env
```

Then edit `.env`: set `MONGODB_URI` to your development database and replace
`JWT_SECRET` with a random value. The server refuses to start with the
placeholder. You can generate a value with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Environment variables

| Variable                    | Used by | Required | Default                     |
| --------------------------- | ------- | -------- | --------------------------- |
| `NODE_ENV`                  | server  | no       | `development`               |
| `PORT`                      | server  | no       | `5000`                      |
| `MONGODB_URI`               | server  | **yes**  | —                           |
| `CLIENT_ORIGIN`             | server  | **yes**  | — (comma-separated origins) |
| `LOG_LEVEL`                 | server  | no       | `info`                      |
| `RATE_LIMIT_WINDOW_MS`      | server  | no       | `900000`                    |
| `RATE_LIMIT_MAX`            | server  | no       | `300`                       |
| `JWT_SECRET`                | server  | **yes**  | — (≥ 32 characters)         |
| `JWT_EXPIRES_IN`            | server  | no       | `1h` (idle timeout)         |
| `SESSION_MAX_AGE`           | server  | no       | `7d`                        |
| `AUTH_COOKIE_SECURE`        | server  | no       | `true` in production        |
| `AUTH_COOKIE_SAMESITE`      | server  | no       | `lax`                       |
| `AUTH_RATE_LIMIT_WINDOW_MS` | server  | no       | `900000`                    |
| `AUTH_RATE_LIMIT_MAX`       | server  | no       | `10`                        |
| `SOCKET_*` (5 limits)       | server  | no       | see `.env.example`          |
| `VITE_API_URL`              | client  | no       | `/api` (same origin)        |
| `VITE_SOCKET_URL`           | client  | no       | same origin                 |

`VITE_*` values are public (embedded in the bundle). Full rules:
[docs/13-env-and-config.md](docs/13-env-and-config.md).

## Development

```bash
npm run dev
```

This starts the API on `http://localhost:5000` (auto-restart on change) and the
client on `http://localhost:5173`. The Vite dev server proxies `/api` and
`/socket.io` to the API. Open the client to register or sign in;
`/status` shows live backend and database status without signing in.

## Testing

| Command                    | What runs                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`        | server unit tests + client component/unit tests (no database)                                                                                             |
| `npm run test:integration` | server HTTP, database, Socket.IO and process-startup tests against an ephemeral in-memory MongoDB                                                         |
| `npm test`                 | both of the above                                                                                                                                         |
| `npm run test:e2e`         | Playwright (desktop + mobile Chromium) against the production client build, real backend and an ephemeral MongoDB — all started and stopped automatically |

No test reads `.env`, and no test database has to be created or cleaned up by
hand. Under `NODE_ENV=test` the server refuses any non-local MongoDB URI.
Test users are generated on the reserved `example.test` domain, and JWT
signing secrets are generated randomly for each run. Authentication is
covered by unit, API integration, dedicated security tests (forged and edited
tokens, leakage, CSRF/CORS, rate limits), Socket.IO handshake tests,
component tests and Playwright E2E.
Strategy and coverage: [docs/09-testing-strategy.md](docs/09-testing-strategy.md).

## Verification

```bash
npm run verify
```

This runs every quality gate in order and stops at the first failure:

```text
format check → lint → unit tests → integration + Socket.IO tests → build → E2E → security (npm audit + secret scan)
```

It prints a PASS/FAIL summary and exits non-zero on any failure. CI
(`.github/workflows/ci.yml`) runs the same gates on every push to `main` and
every pull request, and uploads the Playwright report, traces and backend log
when E2E fails. Details: [docs/10-automation-and-quality-gates.md](docs/10-automation-and-quality-gates.md).

Other scripts: `npm run lint`, `npm run format`, `npm run format:check`,
`npm run build`, `npm run security`.

## API and Socket.IO

- REST contract: [docs/05-api-spec.md](docs/05-api-spec.md) (implemented today:
  health and readiness, authentication, users, conversations, messages, error
  envelope and error codes)
- Socket.IO contract: [docs/06-websocket-protocol.md](docs/06-websocket-protocol.md)
  (implemented: authenticated connections, room authorization, all documented
  events, acknowledgements, rate limits, reconnect behaviour)
- Security design: [docs/07-auth-security.md](docs/07-auth-security.md)
  (the "Implementation" section describes the auth model, cookie threat model
  and known limitations)
- Data model: [docs/04-data-model.md](docs/04-data-model.md) (implemented: User,
  RevokedSession, Conversation, Message, with their indexes)

## Roadmap

From [docs/11-implementation-plan.md](docs/11-implementation-plan.md):

- [x] **Phase 0** — Foundation: workspace, tooling, config, database and Socket.IO boundaries, health/readiness, tests, CI, `npm run verify`
- [x] **Phase 1** — Authentication: user model, registration/login, JWT cookie sessions with revocation, auth UI, protected routes, Socket.IO handshake auth
- [x] **Phase 2** — Conversations and messages: models and indexes, user directory, public room, private conversations, REST messaging, cursor pagination, authorization, minimal REST chat UI
- [x] **Phase 3** — Real-time messaging: authenticated sockets, room authorization, persisted-then-broadcast messages with acks and dedup, live conversation list, typing, read receipts, presence, reconnect/resync, revocation, rate limits
- [ ] **Phase 4** — Frontend chat UI
- [ ] **Phase 5** — E2E coverage of chat flows
- [ ] **Phase 6** — Hardening
- [ ] **Phase 7** — Finalization and deployment

## Deployment

Not configured yet. No deployment infrastructure is claimed.

## Project documentation

Specifications live in [`docs/`](docs). Start with the
[project charter](docs/00-project-charter.md), [PRD](docs/01-prd.md) and
[agent rules](docs/14-claude-agent-rules.md). The documents are kept in sync with
the implementation; sections marked "Implementation status" describe what exists.
