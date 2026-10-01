# Socket.IO Event Contract

## Implementation status (Phase 0 + Phase 1 handshake authentication)

The Socket.IO **foundation** (Phase 0) and **handshake authentication**
(Phase 1) are implemented and integration-tested
(`apps/server/tests/integration/socket.test.js`, `socket.auth.test.js`).
**No application events are registered yet**: every event below is a
specification for Phase 3.

What exists today (`apps/server/src/sockets/`):

| Concern              | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server setup         | `createSocketServer(httpServer, { config, logger, middlewares })` (`middlewares` is required so a server cannot start without authentication) attaches to the same HTTP server/port as the REST API. Default path `/socket.io`; `serveClient: false`.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CORS                 | Only `CLIENT_ORIGIN` origins, with credentials (same policy as REST).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Payload limit        | `maxHttpBufferSize` = 100 KB per packet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Handshake auth       | **Every connection must authenticate.** `sockets/middleware/authenticate.js` reads the same HttpOnly session cookie as REST from the handshake `Cookie` header and calls the same `authService.authenticate()` (signature, expiry, session revocation, user existence). On success `socket.data.auth = { userId, sessionId, name }`. Identity in `handshake.auth`/query is ignored, and tokens are not accepted outside the cookie. Failures reject the handshake with `connect_error` whose `message` is the code (`AUTHENTICATION_REQUIRED` or `AUTHENTICATION_INVALID`) and `data = { code, message }`. Further handshake middlewares are added in `sockets/middleware/index.js`. |
| Origin check         | `allowRequest` rejects handshakes and WebSocket upgrades whose `Origin` is not in `CLIENT_ORIGIN` (CORS does not cover WebSocket upgrades; prevents cross-site WebSocket hijacking with the session cookie). Requests without `Origin` (non-browser clients) still need a valid session.                                                                                                                                                                                                                                                                                                                                                                                             |
| Event registry       | `sockets/handlers/index.js` exports handler modules `({ io, socket, logger, on }) => void` (empty now). Each feature adds its own module instead of growing `server.js`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Event error handling | `on(event, handler)` (see `sockets/bindEvent.js`) wraps every handler, as described below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Lifecycle            | Connect/disconnect are logged at `debug` with the socket id only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Graceful shutdown    | `server.close()` closes all sockets, then the HTTP server, then MongoDB. Clients observe `disconnect` with reason `transport close`, so they reconnect automatically to the restarted server (a server-side `io server disconnect` would disable auto-reconnect).                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Handler / acknowledgement convention

Handlers receive the event payload and return (or resolve) a result. Payloads
are validated with the same zod helper as REST (`parseWithSchema`).

If the client passes an acknowledgement callback it receives the REST-style
envelope:

```json
{ "success": true, "data": {} }
```

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": [{ "path": "content", "message": "..." }]
  }
}
```

Without an ack callback, failures are emitted to that socket as the `error`
event (shape below). Expected failures (`AppError`) expose their `code`;
anything unexpected is logged server-side and reported only as
`{ "code": "INTERNAL_ERROR", "message": "Internal server error" }`.

## Connection

_Implemented in Phase 1 as described in the table above (cookie-based JWT
session). Sessions are checked at handshake time; re-validating long-lived
connections after logout/expiry is part of Phase 3._

Client connects with authentication credentials according to the selected JWT strategy.

Server must reject:

- Missing credentials.
- Invalid token.
- Expired token.
- Disabled/revoked session if applicable.

## Client -> Server

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
