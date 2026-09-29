# Socket.IO Event Contract

## Implementation status (Phase 0)

The Socket.IO **foundation** is implemented and integration-tested
(`apps/server/tests/integration/socket.test.js`). **No application events are
registered yet**: every event below is a specification for Phase 3.

What exists today (`apps/server/src/sockets/`):

| Concern              | Implementation                                                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server setup         | `createSocketServer(httpServer, { config, logger })` attaches to the same HTTP server/port as the REST API. Default path `/socket.io`; `serveClient: false`.                                                                                                      |
| CORS                 | Only `CLIENT_ORIGIN` origins, with credentials (same policy as REST).                                                                                                                                                                                             |
| Payload limit        | `maxHttpBufferSize` = 100 KB per packet.                                                                                                                                                                                                                          |
| Handshake boundary   | `sockets/middleware/index.js` exports the ordered `io.use()` middleware list (empty now). JWT handshake auth is added here; a middleware calling `next(new Error('CODE'))` rejects the connection with `connect_error`.                                           |
| Event registry       | `sockets/handlers/index.js` exports handler modules `({ io, socket, logger, on }) => void` (empty now). Each feature adds its own module instead of growing `server.js`.                                                                                          |
| Event error handling | `on(event, handler)` (see `sockets/bindEvent.js`) wraps every handler, as described below.                                                                                                                                                                        |
| Lifecycle            | Connect/disconnect are logged at `debug` with the socket id only.                                                                                                                                                                                                 |
| Graceful shutdown    | `server.close()` closes all sockets, then the HTTP server, then MongoDB. Clients observe `disconnect` with reason `transport close`, so they reconnect automatically to the restarted server (a server-side `io server disconnect` would disable auto-reconnect). |

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
