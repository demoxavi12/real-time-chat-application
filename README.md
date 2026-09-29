# Real-Time Chat Application

A full-stack real-time messaging platform built with React, Node.js,
Express.js, MongoDB, Socket.IO and JWT.

> **Status: Phase 0 — project foundation.** The architecture, tooling, test
> infrastructure and quality gates are in place. **No chat functionality exists
> yet**: there is no registration/login, no users, conversations or messages,
> and no chat UI. See the [roadmap](#roadmap).

## What exists today

- **Backend** (`apps/server`): Express 5 + Socket.IO 4 + Mongoose 9
  - validated environment configuration that fails fast with clear messages
  - MongoDB connection abstraction with graceful shutdown
  - `GET /health` (liveness) and `GET /ready` (live MongoDB ping), also under `/api`
  - Helmet security headers, CORS allow-list, 100 KB body limit, per-IP API rate limiting
  - standard `{ success, data | error }` envelope, centralized error handling
    (no stack traces or internal messages in responses), zod request validation
  - Socket.IO server with a handshake-middleware boundary, a handler registry,
    centralized event error handling and graceful shutdown — **no chat events yet**
  - structured JSON logging with automatic redaction of secrets
- **Frontend** (`apps/client`): React 19 + Vite 8
  - validated `VITE_*` configuration (defaults to same-origin)
  - REST client boundary (envelope-aware) and Socket.IO client boundary (not connected yet)
  - a system status page showing live backend and database status
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

Then edit `.env` and set `MONGODB_URI` to your development database.

## Environment variables

| Variable                       | Used by | Required     | Default                     |
| ------------------------------ | ------- | ------------ | --------------------------- |
| `NODE_ENV`                     | server  | no           | `development`               |
| `PORT`                         | server  | no           | `5000`                      |
| `MONGODB_URI`                  | server  | **yes**      | —                           |
| `CLIENT_ORIGIN`                | server  | **yes**      | — (comma-separated origins) |
| `LOG_LEVEL`                    | server  | no           | `info`                      |
| `RATE_LIMIT_WINDOW_MS`         | server  | no           | `900000`                    |
| `RATE_LIMIT_MAX`               | server  | no           | `300`                       |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | server  | from Phase 1 | not read yet                |
| `VITE_API_URL`                 | client  | no           | `/api` (same origin)        |
| `VITE_SOCKET_URL`              | client  | no           | same origin                 |

`VITE_*` values are public (embedded in the bundle). Full rules:
[docs/13-env-and-config.md](docs/13-env-and-config.md).

## Development

```bash
npm run dev
```

This starts the API on `http://localhost:5000` (auto-restart on change) and the
client on `http://localhost:5173`. The Vite dev server proxies `/api` and
`/socket.io` to the API. Open the client to see live backend and database status.

## Testing

| Command                    | What runs                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`        | server unit tests + client component/unit tests (no database)                                                                                             |
| `npm run test:integration` | server HTTP, database, Socket.IO and process-startup tests against an ephemeral in-memory MongoDB                                                         |
| `npm test`                 | both of the above                                                                                                                                         |
| `npm run test:e2e`         | Playwright (desktop + mobile Chromium) against the production client build, real backend and an ephemeral MongoDB — all started and stopped automatically |

No test reads `.env`, and no test database has to be created or cleaned up by
hand. Under `NODE_ENV=test` the server refuses any non-local MongoDB URI.
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
  health and readiness, error envelope and error codes)
- Socket.IO contract: [docs/06-websocket-protocol.md](docs/06-websocket-protocol.md)
  (implemented today: connection lifecycle and conventions; no events)
- Security design: [docs/07-auth-security.md](docs/07-auth-security.md)

## Roadmap

From [docs/11-implementation-plan.md](docs/11-implementation-plan.md):

- [x] **Phase 0** — Foundation: workspace, tooling, config, database and Socket.IO boundaries, health/readiness, tests, CI, `npm run verify`
- [ ] **Phase 1** — Authentication: user model, registration/login, JWT
- [ ] **Phase 2** — Conversations and messages (REST, authorization, pagination)
- [ ] **Phase 3** — Socket.IO: handshake auth, messaging, presence, typing, read state, reconnection
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
