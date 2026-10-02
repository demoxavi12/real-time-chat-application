# Socket.IO Event Contract

## Implementation status (Phase 3 — implemented)

Real-time messaging is implemented and integration/E2E-tested
(`apps/server/tests/integration/socket*.test.js`, `e2e/realtime.spec.js`).
MongoDB stays the source of truth: socket delivery is a notification of
durable state, never a history mechanism.

### Connection and authentication

- Same server/port as REST, path `/socket.io`, `serveClient: false`.
- `allowRequest` rejects any handshake/WebSocket upgrade whose `Origin` is
  not in `CLIENT_ORIGIN` (cross-site WebSocket hijacking). CORS allows only
  those origins, with credentials.
- Handshake middlewares (required — a server cannot start without them):
  1. per-IP connection rate limit → `connect_error` `RATE_LIMITED`;
  2. authentication with the **same HttpOnly session cookie and the same
     `authService.authenticate()` as REST** (pinned JWT algorithm, issuer,
     audience, expiry, absolute session age, revocation denylist, user
     existence). Identity in `handshake.auth`/query is ignored; tokens are
     accepted only from the cookie.
- Failures: `connect_error` with `message` = code and `data = { code, message }`.
  Missing cookie → `AUTHENTICATION_REQUIRED`; malformed, forged, wrong
  algorithm, expired, revoked session, or deleted user → `AUTHENTICATION_INVALID`.
- On connection every socket joins `user:<userId>` and `session:<sessionId>`.
  Each socket is authenticated independently: any number of tabs/devices
  per user.
- **Revocation:** `POST /api/auth/logout` disconnects every socket of that
  session (`disconnect` reason `io server disconnect`, so clients do not
  auto-reconnect); new handshakes with the revoked cookie fail. Other
  sessions (devices) stay connected.
- **Session end:** each socket is disconnected when its session reaches
  `SESSION_MAX_AGE` after sign-in.
- Room names are built only in `sockets/rooms.js`:
  `conversation:<id>`, `user:<id>`, `session:<sid>`.

### Events (client → server)

All payloads are strictly validated (unknown keys such as `senderId`,
`userId`, `authorized` are rejected with `VALIDATION_ERROR`). Every event
may pass an acknowledgement callback and receives the REST-style envelope
`{ success: true, data }` / `{ success: false, error: { code, message, details? } }`.

| Event                          | Payload                                        | Authorization / behaviour                                                                                                                        | Ack `data`             |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| `conversation:join`            | `{ conversationId }`                           | Same rule as REST (`getAccessible`): public room for everyone, private for its two participants; otherwise `CONVERSATION_NOT_FOUND`. Idempotent. | `{ conversationId }`   |
| `conversation:leave`           | `{ conversationId }`                           | Leaves the room (no-op if not joined); clears my typing state there                                                                              | `{ conversationId }`   |
| `message:send`                 | `{ conversationId, clientMessageId, content }` | Access re-checked on every send; same content rules and dedup as REST (`clientMessageId` **required** here)                                      | see below              |
| `message:read`                 | `{ conversationId, messageId }`                | Access checked; private conversations only (public → `recorded: false`); message must belong to the conversation (`MESSAGE_NOT_FOUND`)           | `{ recorded }`         |
| `typing:start` / `typing:stop` | `{ conversationId }`                           | Must have joined the room (`CONVERSATION_NOT_FOUND` otherwise); ephemeral, never stored                                                          | `{ conversationId }`   |
| `presence:list`                | none                                           | Extension: currently online user ids                                                                                                             | `{ online: [userId] }` |

### message:send semantics

```text
validate -> authorize -> messageService.send (MongoDB insert or dedup)
         -> on success only: ack to sender + message:new to the room
                             + conversation:update to participants
```

- Successful ack (`message:ack` contract plus the canonical message):
  `{ clientMessageId, messageId, createdAt, duplicate, message }`.
  Without an ack callback the same object is emitted as the `message:ack` event.
- **Nothing is announced unless the database write succeeded.** On failure
  the sender gets `INTERNAL_ERROR` (or the validation/authorization code) and
  nobody else receives anything; a retry with the same `clientMessageId`
  then stores the message exactly once (tested with an injected write failure).
- **Retries:** same conversation + same authenticated sender + same
  `clientMessageId` → the original message with `duplicate: true` (also for
  concurrent duplicates, and shared with REST). It is not broadcast again.
  The same id in another conversation or from another user is a new message.
- `message:new` goes to every socket in `conversation:<id>` **except the
  sending socket** (which has the ack); the sender's other tabs receive it.
  Clients merge by message id, so a duplicate delivery is harmless.
- REST `POST /api/conversations/:id/messages` triggers the same
  notifications through the same hub (`sockets/realtime.js`).
- If a recipient is offline the message stays stored; it is recovered from
  REST history after reconnecting. A broadcast problem never rolls back or
  fails a stored message.

### Events (server → client)

| Event                 | Payload                                                               | Audience                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `message:new`         | `{ message }` (canonical REST message shape)                          | sockets in `conversation:<id>` except the sender's socket                                                                                              |
| `message:ack`         | as the ack `data` above                                               | the sending socket, only when it gave no ack callback                                                                                                  |
| `conversation:update` | `{ conversation }` (REST conversation shape, updated `lastMessageAt`) | private: both participants' `user:<id>` rooms; public room: all authenticated sockets. Sent on new messages and when a private conversation is created |
| `typing:update`       | `{ conversationId, userId, typing }`                                  | the room, except the typing socket; `typing: false` is also sent on send, leave and disconnect                                                         |
| `message:read:update` | `{ conversationId, messageId, userId }`                               | the room; only when `readBy` actually changed                                                                                                          |
| `presence:update`     | `{ userId, status: "online"                                           | "offline" }`                                                                                                                                           | all authenticated sockets |
| `error`               | `{ code, message }`                                                   | the socket, for failures of events sent without an ack callback                                                                                        |

### Presence

A user is online while at least one authenticated socket is connected
(counted per user, so closing one tab of several changes nothing). Going
offline updates `lastSeenAt`. State is in process memory (single instance,
ADR-004) and visible to every signed-in user (everyone shares the public
room).

### Rate limits and payload bounds

| Limit                                                           | Default    | Env                            |
| --------------------------------------------------------------- | ---------- | ------------------------------ |
| Connection attempts per client IP                               | 30 / 10 s  | `SOCKET_CONNECTION_RATE_LIMIT` |
| Events per socket (all)                                         | 120 / 10 s | `SOCKET_EVENT_RATE_LIMIT`      |
| `message:send` per socket                                       | 30 / 10 s  | `SOCKET_MESSAGE_RATE_LIMIT`    |
| Invalid payloads or unknown events per socket before disconnect | 20 / 10 s  | `SOCKET_INVALID_EVENT_LIMIT`   |
| Window for all of the above                                     | 10 s       | `SOCKET_RATE_LIMIT_WINDOW_MS`  |

Over a limit an event is answered `RATE_LIMITED` (or the socket is
disconnected for invalid/unknown event floods). Packets above 100 KB close
the connection; message content is bounded to 2000 characters like REST.

### Reconnection (client contract)

Socket.IO reconnects automatically with bounded backoff (1–10 s). After every
reconnect the client re-authenticates (cookie), rejoins its rooms, and
refetches durable state over REST. Server room state is per process and is
rebuilt from these rejoins (tested across a full server restart).

### Handler / acknowledgement convention

Handlers receive the event payload and return (or resolve) a result. Payloads
are validated with the same zod helper as REST (`parseWithSchema`).
Unexpected errors are logged server-side (never message content) and reported
only as `{ "code": "INTERNAL_ERROR", "message": "Internal server error" }`.

## Connection

_Implemented as described above: cookie-based JWT session at handshake,
live sockets disconnected on logout and at the session's absolute end._

Client connects with authentication credentials according to the selected JWT strategy.

Server must reject:

- Missing credentials.
- Invalid token.
- Expired token.
- Disabled/revoked session if applicable.

## Client -> Server

_The original contract below is implemented as specified (see the
tables above for authorization, acknowledgements and extensions)._

### conversation:join

```json
{
  "conversationId": "..."
}
```

### conversation:leave

```json
{
  "conversationId": "..."
}
```

### message:send

```json
{
  "conversationId": "...",
  "clientMessageId": "...",
  "content": "Hello"
}
```

### typing:start

```json
{
  "conversationId": "..."
}
```

### typing:stop

```json
{
  "conversationId": "..."
}
```

### message:read

```json
{
  "conversationId": "...",
  "messageId": "..."
}
```

## Server -> Client

### message:new

```json
{
  "message": {
    "id": "...",
    "conversationId": "...",
    "sender": {},
    "content": "...",
    "createdAt": "..."
  }
}
```

### message:ack

```json
{
  "clientMessageId": "...",
  "messageId": "...",
  "createdAt": "..."
}
```

### presence:update

```json
{
  "userId": "...",
  "status": "online"
}
```

### typing:update

```json
{
  "conversationId": "...",
  "userId": "...",
  "typing": true
}
```

### message:read:update

```json
{
  "conversationId": "...",
  "messageId": "...",
  "userId": "..."
}
```

### error

```json
{
  "code": "FORBIDDEN",
  "message": "Not authorized"
}
```

## Event rules

1. Every incoming event is validated.
2. Every protected event checks authenticated identity.
3. Every conversation event checks membership.
4. Message persistence occurs before broadcasting the durable message.
5. Broadcast payloads contain only fields clients need.
6. Never broadcast password hashes, JWTs, internal errors, or private metadata.
7. Typing events are ephemeral and rate-limited.
8. Client retries must not create duplicate durable messages.
9. Event names and payload shapes are treated as contracts and must have integration tests.
