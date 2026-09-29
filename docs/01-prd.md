# Product Requirements Document

## 1. Problem

Traditional CRUD applications do not demonstrate persistent bidirectional communication. This project demonstrates how a modern web client maintains authenticated real-time communication with a Node.js server while REST APIs provide durable resource operations.

## 2. Users

### Guest

- Can access the authentication pages.
- Cannot read private/public messages until authenticated.

### Authenticated user

- Can view their account.
- Can enter the public room.
- Can start a private conversation with another user.
- Can send and receive messages in real time.
- Can see presence and typing state.
- Can load older messages.

## 3. Core user stories

### Authentication

- As a guest, I can register with valid credentials.
- As a user, I can log in securely.
- As a user, I remain authenticated after page refresh according to the chosen session strategy.
- As a user, I can log out and invalidate my active session/token where supported.

### Public chat

- As an authenticated user, I can join the public room.
- I can send a message.
- Other connected users receive the message without refreshing.
- Messages survive server restart because they are persisted.

### Private chat

- I can select another user and open a 1-to-1 conversation.
- Only authorized participants can retrieve/send messages in that conversation.
- A private message is delivered in real time to the intended recipient.

### Presence

- Connected users appear online.
- Disconnecting users become offline.
- Temporary network loss should not create duplicate users/sessions.

### Typing

- A user can emit typing state.
- Other participants receive typing state.
- Typing state expires automatically.

### History

- Opening a conversation loads recent messages.
- Scrolling/pagination loads older messages.
- Message ordering is deterministic.

## 4. Non-functional requirements

- Validate all client input again on the server.
- Never trust a client-supplied user ID for authorization.
- Use indexed MongoDB queries for conversation history.
- Prevent duplicate message creation during retries where practical.
- Use bounded payload sizes.
- Rate-limit authentication and message endpoints/events.
- Avoid blocking synchronous work in request handlers.
- Provide structured errors without leaking secrets or stack traces in production.

## 5. UX requirements

- Responsive desktop/mobile layout.
- Clear connection status.
- Clear loading/error/empty states.
- Optimistic UI only where reconciliation is implemented.
- Disable/guard duplicate submissions.
- Preserve unsent text during transient connection failures where practical.

## 6. Acceptance criteria

A feature is accepted only if its happy path, validation path, authorization path, persistence behavior, and failure/reconnect behavior are covered by automated tests.
