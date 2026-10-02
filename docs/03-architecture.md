# System Architecture

## 1. High-level architecture

```text
React Client
   |
   +---- HTTPS REST ----> Express API ----> Services ----> MongoDB
   |
   +---- Socket.IO -----> Socket Gateway --> Services --> MongoDB
                              |
                              +--> Presence / room state
```

## 2. Architectural boundaries

### Frontend

Responsibilities:

- Rendering UI.
- Managing local UI state.
- Calling REST APIs.
- Maintaining Socket.IO connection.
- Displaying connection/presence/message state.
- Never implementing authorization rules.

Suggested layers:

```text
src/
  components/
  pages/
  features/
    auth/
    chat/
    users/
  hooks/
  services/
    api/
    socket/
  context/
  utils/
  validation/
  tests/
```

### Backend

Responsibilities:

- Authentication.
- Authorization.
- Input validation.
- Business rules.
- Persistence.
- Socket event handling.
- HTTP error mapping.

Suggested layers:

```text
src/
  config/
  controllers/
  middleware/
  models/
  routes/
  services/
  repositories/
  sockets/
  validators/
  utils/
  app.js
  server.js
```

## 3. REST vs Socket.IO

### REST

Use for:

- Register/login/logout/session.
- Current user.
- User search/list.
- Conversation creation/listing.
- Message history.
- Health/readiness.
- Administrative/resource operations.

### Socket.IO

Use for:

- Real-time message delivery.
- Presence changes.
- Typing indicators.
- Delivery/read updates.
- Room join/leave notifications.

## 4. Server authority

The server decides:

- Who the user is.
- Whether the user may access a conversation.
- Whether a message is valid.
- Whether a message is persisted.
- Message timestamps.
- Message IDs.
- Presence state.

## 5. Scalability note

MVP can use a single Node.js instance. The architecture must isolate ephemeral Socket.IO state from durable MongoDB state so a future Redis adapter can be introduced without rewriting product logic.

Do not claim horizontal Socket.IO scaling unless a multi-instance adapter and shared state strategy are actually implemented.

## 6. Reliability

- Graceful shutdown.
- MongoDB connection handling.
- Socket reconnect with bounded backoff.
- Idempotency/client message IDs where needed.
- Health endpoint.
- Readiness endpoint.
- Structured logging.

## 7. Implemented foundation (Phase 0)

This section describes what exists in the repository today. Sections 1–6
remain the target architecture.

### Repository

npm workspaces, no monorepo framework (see `15-repository-structure.md`):
`apps/client` (React + Vite), `apps/server` (Express + Socket.IO + Mongoose),
root-level tooling (ESLint, Prettier, Playwright, scripts, CI).

### Backend (`apps/server/src`)

```text
index.js          process entry: loads repo-root .env (not under NODE_ENV=test),
                  validates config, starts server, handles SIGINT/SIGTERM,
                  unhandledRejection/uncaughtException -> graceful shutdown
server.js         startServer(): connect MongoDB -> register models + ensure
                  indexes -> compose auth (token service, auth service, cookie,
                  authenticate) -> build app -> HTTP server -> Socket.IO (auth
                  middleware) -> listen; returns { port, io, database, models,
                  close() }
app.js            createApp(): pure Express construction (no I/O), testable with
                  injected dependencies
config/env.js     zod-validated, frozen config; fails with every problem listed
config/database.js createDatabase(): one Mongoose connection (createConnection),
                  ping() for readiness, disconnect() for shutdown
middleware/       requestId, requestLogger, validate, rateLimiter, notFound,
                  errorHandler, authenticate, authorize, requireAllowedOrigin
models/           User, RevokedSession schemas; registerModels(connection),
                  ensureIndexes()
repositories/     user, revokedSession, conversation, message (indexed,
                  bounded queries only)
services/         readiness, password (Argon2id), token (JWT), auth,
                  conversation (access rule, open-or-create, listing),
                  message (send with dedup, cursor history), userDirectory,
                  pagination (opaque keyset cursors)
policies/         conversationAccess (authorize() policy: loads the
                  conversation for req.auth or 404)
routes/ controllers/   health, auth, users and conversations routers ->
                  controllers -> services
sockets/          createSocketServer (Origin check, per-socket limits, user/
                  session rooms, session-end timer), bindEvent (acks, errors,
                  rate limits), rooms (room names), realtime (notification hub
                  shared with REST), presence (in-memory), handlers/chat
                  (join/leave, message:send, message:read, typing, presence),
                  middleware/ (connection rate limit, handshake auth)
validators/       parseWithSchema (shared by HTTP and Socket.IO), auth,
                  common (ids, limits, cursors) and conversation/message schemas
utils/            AppError + error codes, response envelope, JSON logger with
                  redaction, withTimeout, duration parser, auth cookie
```

Models are registered on `database.connection`, not on the global mongoose
singleton (ADR-008). Authentication flow and security properties are
described in `07-auth-security.md` (Implementation section).

Middleware order: request id → request log → Helmet → CORS → JSON body (100 KB)
→ `/health`, `/ready` → `/api` (probes, then the Origin check for unsafe methods,
then the rate limiter, then the `/auth` router with its own auth rate limits;
protected routes use `authenticate` [+ `authorize(policy)`])
→ 404 → central error handler.

Startup is fail-fast: invalid config or an unreachable MongoDB exits with code
1 and a clear message. After startup, database outages are surfaced through
`/ready` (503) while `/health` stays 200.

Shutdown order: stop accepting HTTP/Socket.IO connections and disconnect
sockets → let in-flight requests finish → close MongoDB → exit 0 (forced exit
with code 1 after 10 s).

### Frontend (`apps/client/src`)

```text
config/              resolveClientConfig(): validated VITE_* URLs (defaults:
                     same-origin /api and same-origin Socket.IO)
services/api/        createHttpClient (envelope-aware fetch wrapper, ApiError,
                     credentials: include), systemApi, authApi
services/socket/     createSocketClient (autoConnect: false, bounded backoff)
features/auth/       AuthProvider + useAuth (status: loading | authenticated |
                     unauthenticated | error), LoginPage, RegisterPage,
                     RequireAuth / GuestOnly route guards, validation
features/system/     SystemStatus + useSystemStatus (backend health/readiness)
features/realtime/   RealtimeProvider (one socket, one listener per event,
                     room refcounts, rejoin + REST resync on reconnect, auth
                     loss), useRealtime / useRealtimeEvent
features/chat/       useConversations, useMessages, useTypingAndReads, ConversationList,
                     UserSearch, ConversationView, MessageComposer (REST)
pages/HomePage.jsx   protected chat shell (account bar, conversation list,
                     user search, <Outlet> for the selected conversation)
components/          FormField (accessible labelled input)
App.jsx              routes: / and /conversations/:id (protected, nested),
                     /login + /register (guests),
                     /status (public); main.jsx wraps it in BrowserRouter
```

The session is restored on load with `GET /api/auth/me`; the token is an
HttpOnly cookie the client never sees. Durable state (lists, history) comes
from REST; live updates (messages, conversation activity, typing, read
receipts, presence) come over one Socket.IO connection that sends messages
with acknowledgements and falls back to REST while disconnected.

### Real-time flow

```text
client message:send ─► validate ─► authorize ─► messageService.send ─► MongoDB
                                                      │ success only
                          ack to sender ◄─────────────┤
            message:new to conversation room ◄────────┤ (realtime hub, also
  conversation:update to participants ◄───────────────┘  used by REST sends)
```

### Logging

`utils/logger.js` writes JSON lines. Keys matching password/secret/token/jwt/
authorization/cookie/api key/credential/MongoDB URI are replaced with
`[REDACTED]` at any depth. Request logs contain method, path (no query
string), status, duration and request id only.
