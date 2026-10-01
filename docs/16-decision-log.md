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

## ADR-013 — Argon2id for password hashing

**Status:** Accepted (Phase 1)

**Decision:** `argon2` (native, prebuilt binaries for Windows/Linux/macOS) with Argon2id, m = 19 MiB, t = 2, p = 1 (OWASP baseline). Password policy 8–128 characters, no composition rules. Unknown-email logins verify against a dummy hash to equalize timing.

**Alternatives considered:** bcrypt (72-byte input truncation, not memory-hard); Node `crypto.scrypt` (acceptable, but Argon2id is the documented preference); built-in `crypto.argon2` (requires Node ≥ 24.7, the project supports Node 20/22).

## ADR-014 — JWT session in an HttpOnly cookie (no token in JS)

**Status:** Accepted (Phase 1)

**Decision:** HS256 JWTs signed with `jose`, verification pinned to algorithm, issuer and audience. The token is delivered only as an HttpOnly, SameSite=Lax (configurable), Path=/ cookie; Secure + `__Host-` prefix in production (non-Secure is rejected in production). Never in a response body or Web Storage. CSRF is mitigated by SameSite plus an Origin allow-list check on unsafe `/api` methods; WebSocket hijacking by an Origin check in Socket.IO `allowRequest`. The same cookie authenticates the Socket.IO handshake.

**Consequences:** XSS cannot exfiltrate the token. Client and API must be same-site (true for the Vite proxy, a reverse proxy, or `localhost`/`127.0.0.1` with different ports); otherwise `SameSite=None; Secure` is required. Non-browser clients send the cookie header explicitly; `Authorization: Bearer` is intentionally not supported yet.

**Alternatives considered:** token in `localStorage` + Bearer header (XSS-exfiltratable, rejected by `07-auth-security.md`); opaque server sessions (equivalent here, but the docs specify JWT).

## ADR-015 — Revocable sliding sessions instead of refresh tokens

**Status:** Accepted (Phase 1)

**Context:** `07-auth-security.md` asks for short-lived access tokens and real logout. Pure stateless JWTs cannot be revoked; a refresh-token pair adds a second token, rotation and reuse detection.

**Decision:** One token per request path. Each token carries a session id (`sid`) and sign-in time (`auth_time`). Lifetime `JWT_EXPIRES_IN` (default 1 h) is an idle timeout; past half-life any authenticated request gets a renewed token for the same session, capped at `SESSION_MAX_AGE` (default 7 d). Every authenticated request checks that the user exists and that `sid` is not in the `revokedsessions` denylist (TTL-indexed). Logout revokes the `sid`, invalidating all tokens of that session immediately.

**Consequences:** Two indexed MongoDB lookups per authenticated request (acceptable; also needed to reject deleted users). Socket connections are checked at handshake time; mid-connection revocation handling is Phase 3 work. `.env.example` changed `JWT_EXPIRES_IN` from `15m` to `1h` because it is now an idle timeout rather than an access-token lifetime paired with a refresh token.

## ADR-016 — Authentication rate limits

**Status:** Accepted (Phase 1)

**Decision:** Separate per-IP limiters on `POST /api/auth/register` (every attempt) and `POST /api/auth/login` (`skipSuccessfulRequests`: only failures count), default 10 per 15 minutes, configurable via `AUTH_RATE_LIMIT_*`, on top of the general `/api` limit. No per-account lockout (avoids attacker-triggered lockouts).

**Consequences:** Per-IP limiting requires `trust proxy` configuration before deploying behind a proxy (Phase 6). E2E raises the limits because every test user comes from `127.0.0.1`; rate limiting itself is covered by integration tests.

## ADR-017 — Duplicate registration returns 409

**Status:** Accepted (Phase 1)

**Decision:** `POST /api/auth/register` with an existing email returns `409 EMAIL_ALREADY_EXISTS`, as required by the API contract and phase requirements. This reveals account existence (enumeration); login does not (generic `INVALID_CREDENTIALS`, equal timing). Mitigated by the registration rate limit. Revisit if email verification is introduced (then registration can respond uniformly).

## ADR-018 — `react-router` and an explicit auth state machine on the client

**Status:** Accepted (Phase 1)

**Decision:** `react-router` (v7) for `/`, `/login`, `/register`, `/status`. Auth state lives in a small `AuthProvider` context with `status: loading | authenticated | unauthenticated | error`; the session is restored with `GET /api/auth/me`. `RequireAuth` and `GuestOnly` guards own all auth redirects (including the return to the originally requested page, restricted to same-app paths), which avoids redirect loops and races between page code and guards. The Phase 0 status page moved to the public `/status` route and is also shown in the signed-in shell.

## ADR-019 — Socket.IO servers cannot start without handshake middleware

**Status:** Accepted (Phase 1)

**Decision:** `createSocketServer` requires an explicit `middlewares` array; `startServer` passes the authentication middleware by default. Tests may inject other middlewares, but no code path silently starts an unauthenticated Socket.IO server.

## ADR-020 — Private conversation uniqueness via a deterministic key and a unique index

**Status:** Accepted (Phase 2)

**Decision:** Each private conversation stores `privateKey` = the two participant ids sorted and joined. A unique index on `privateKey` (partial on `type: "private"`) makes MongoDB itself reject a second conversation for the same pair. Opening is find → create → on duplicate-key error read the winner. The read first is only a fast path; correctness comes from the index.

**Consequences:** Concurrent opens (tested with 12 HTTP and 20 repository-level parallel calls, plus a forced race) always yield one conversation; at most one caller gets `201`, the rest `200`.

**Alternatives considered:** a multi-document transaction (needs a replica set, still needs a uniqueness rule); a unique index on the `participantIds` array (multikey indexes enforce uniqueness per element, not per pair, so it would allow only one conversation per user).

## ADR-021 — Public room as an index-enforced singleton

**Status:** Accepted (Phase 2)

**Decision:** `docs/04` allows the public room to be a singleton system conversation. One `type: "public"` conversation named "General" is created idempotently at startup (same find/create/duplicate-key pattern), guarded by a unique partial index on `type`. It has no participant list: every authenticated user may read and post. No endpoints create groups or change membership because none are specified.

## ADR-022 — Membership authorization with 404 for non-members

**Status:** Accepted (Phase 2)

**Decision:** Every `/conversations/:id/...` route runs `authenticate → validate(params) → authorize(conversationAccess) → validate(query/body) → controller`. The policy loads the conversation for `req.auth.userId` and throws `404 CONVERSATION_NOT_FOUND` for both "does not exist" and "not a participant", and attaches `req.conversation` for the controller. Membership is the `participantIds` array (docs/04) rather than a separate collection. `canAccessConversation` is the single rule to be reused by Socket.IO in Phase 3.

**Consequences:** Ids cannot be probed (identical responses), and non-members never see validation details. `403 FORBIDDEN` remains the generic `authorize()` outcome for future policies where existence is not secret.

## ADR-023 — Keyset (cursor) pagination with (timestamp, _id) ordering

**Status:** Accepted (Phase 2)

**Decision:** Messages are ordered by `(createdAt, _id)` and paged backwards with `limit + 1` keyset queries backed by `{ conversationId: 1, createdAt: -1, _id: -1 }`. Conversation lists use `(lastActivityAt, _id)`, the user directory `_id`. Cursors are opaque base64url JSON with a kind tag; message cursors embed their conversation id and are rejected elsewhere. They are not signed because they only encode a position in data the caller is already authorized to read; they are strictly schema-validated. First page = newest messages, returned oldest → newest; `nextCursor` loads older ones.

**Consequences:** Stable under identical timestamps and concurrent inserts, no skip/offset cost, cursors survive deletion of their message. No "jump to page N".

## ADR-024 — REST message sending with clientMessageId idempotency (Phase 2), sockets later

**Status:** Accepted (Phase 2)

**Decision:** `POST /api/conversations/:id/messages` (not in the original API list) persists messages until Socket.IO `message:send` arrives in Phase 3. Optional `clientMessageId` + a unique partial index on `(conversationId, senderId, clientMessageId)` makes retries idempotent (`200` with the original). Sender and timestamps are server-owned. Content is trimmed plain text, 1–2000 characters.

**Consequences:** The same service will back the Phase 3 socket event, so REST and sockets share validation, dedup and authorization.

## ADR-025 — Index set chosen from actual queries

**Status:** Accepted (Phase 2)

**Decision:** Only indexes with a current query: `private_pair_unique`, `public_room_singleton`, `participant_activity`, `conversation_history`, `client_message_id_unique` (plus Phase 1's). No `{ senderId, createdAt }` index (no such query). User search by name prefix uses a case-insensitive anchored regex bounded by `limit` and `maxTimeMS` rather than a new index; exact email search uses the existing unique index. Index usage of the hot paths is asserted with `explain()` in tests.

**Consequences:** Name-prefix search scans users; acceptable at MVP scale and bounded. If the directory grows, add a normalized `nameLower` field with an index (or a text/Atlas search index).

## ADR-026 — Minimal REST chat UI in Phase 2

**Status:** Accepted (Phase 2)

**Decision:** To exercise the data layer end to end, the client gains a conversation list, user search, history with "load older", and a REST composer (nested routes under `/`, `/conversations/:id`). No live updates: users press Refresh or reload. Phase 3 replaces polling-by-hand with Socket.IO events; Phase 4 polishes the UI.

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
