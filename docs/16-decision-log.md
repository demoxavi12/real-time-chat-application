# Architecture Decision Record Log

Record meaningful decisions here.

## ADR-001 — REST + Socket.IO split

**Decision:** REST handles durable resource operations; Socket.IO handles real-time events.\
**Reason:** Clear separation between request/response resources and bidirectional event delivery.

## ADR-002 — Server-generated message identity

**Decision:** The server generates durable message IDs.\
**Reason:** Prevent clients from controlling authoritative identifiers.

## ADR-003 — Cursor pagination

**Decision:** Use cursor-based pagination for message history.\
**Reason:** More stable for rapidly changing timelines than large offset pagination.

## ADR-004 — Single-instance MVP

**Decision:** Start with one Node.js instance.\
**Reason:** Avoid premature distributed-system complexity while keeping boundaries compatible with future Socket.IO scaling.

## ADR-005 — npm workspaces; existing Vite app moved to `apps/client`

**Status:** Accepted (Phase 0)

**Context:** The repository started as a single Vite + React template at the root. The docs recommend `apps/client` + `apps/server`.

**Decision:** Use plain npm workspaces (`apps/client`, `apps/server`) with shared tooling (ESLint, Prettier, Playwright, scripts) at the root. The Vite app was moved with `git mv` to keep its history. The template demo (counter, marketing links, `hero.png`, `react.svg`, `vite.svg`, `icons.svg`, `App.css`) was removed and replaced by a system status page; `index.html`, `main.jsx`, `favicon.svg`, the design tokens in `index.css`, the ESLint React rules and Vite/React versions were kept.

**Consequences:** One lockfile and one `npm install`; no Turborepo/Nx.

**Alternatives considered:** root `client/` + `server/` without workspaces (duplicated installs/scripts); a monorepo framework (unnecessary at this size).

## ADR-006 — Ephemeral in-memory MongoDB for automated tests

**Status:** Accepted (Phase 0)

**Context:** Tests must never touch a developer or production database, must not require manual database setup/cleanup, and must run on Windows (no Docker available on the development machine) and in CI.

**Decision:** `mongodb-memory-server` starts a real `mongod` on `127.0.0.1` for integration tests (Vitest global setup) and E2E (`scripts/e2e-backend.js`) and deletes it afterwards. Each test file uses a unique database name. Additionally the server refuses non-loopback `MONGODB_URI` values when `NODE_ENV=test`.

**Consequences:** First install downloads the official MongoDB binary (cached afterwards). Replica-set-only features (transactions, change streams) would need `MongoMemoryReplSet` later.

**Alternatives considered:** Docker/Testcontainers (Docker not available locally; heavier); a shared "test" database on a real server (risk of accidental production use, manual cleanup).

## ADR-007 — Health probes at the root and under `/api`

**Status:** Accepted (Phase 0)

**Decision:** `GET /health` and `GET /ready` are mounted both at the server root (conventional for load balancers/orchestrators) and under `/api` (so the client can reach them through its API base URL/proxy). Probes are exempt from rate limiting. `/ready` performs a live MongoDB ping with a timeout; `/health` checks nothing but the process.

## ADR-008 — Explicit Mongoose connection instead of the global singleton

**Status:** Accepted (Phase 0)

**Decision:** `createDatabase()` owns one `mongoose.createConnection()`; future models are registered with `database.connection.model(...)`. `bufferCommands` is disabled so queries fail fast while disconnected instead of hanging.

**Consequences:** No hidden global state; tests can run isolated servers side by side. Repositories receive the connection (or models) via dependency injection.

## ADR-009 — Startup is fail-fast; runtime outages go through readiness

**Status:** Accepted (Phase 0)

**Decision:** Invalid configuration or an unreachable MongoDB at startup exits the process with code 1 and a clear message. After startup, the driver reconnects automatically and `/ready` reports 503 while the database is unreachable.

**Alternatives considered:** Start HTTP before the database and retry forever (masks misconfiguration; more states to test).

## ADR-010 — Same-origin client defaults

**Status:** Accepted (Phase 0)

**Decision:** `VITE_API_URL`/`VITE_SOCKET_URL` are optional. When unset the client uses `/api` and the page origin; the Vite dev server proxies `/api` and `/socket.io` to the backend. Absolute URLs are supported (and used by E2E to exercise CORS).

**Consequences:** `npm run build` works without any `.env` and embeds no host names. Cross-origin deployments set the variables and list the client origin in `CLIENT_ORIGIN`.

## ADR-011 — Small in-house utilities instead of extra dependencies

**Status:** Accepted (Phase 0)

**Decision:** A ~60-line JSON logger with key-based redaction (instead of pino) and a Node secret-scan script (instead of gitleaks) — both run identically on Windows, Linux and CI without extra binaries. `zod` is used for both environment and request/socket payload validation.

**Alternatives considered:** pino + pino-http (revisit if log volume/performance requires it); gitleaks (can be added to CI later as a second scanner).

## ADR-012 — Pre-commit hooks deferred

**Status:** Proposed

**Context:** `10-automation-and-quality-gates.md` suggests Husky/lint-staged. Installing hooks changes the developer's Git configuration (`core.hooksPath`) on every `npm install`.

**Decision:** Not added in Phase 0; the same checks run in `npm run verify` and CI. Revisit with the maintainer's agreement.

## Future ADR template

### ADR-XXX — Title

**Status:** Proposed / Accepted / Rejected / Superseded

**Context:**\
...

**Decision:**\
...

**Consequences:**\
...

**Alternatives considered:**\
...
