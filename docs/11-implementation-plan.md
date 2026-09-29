# Implementation Plan

## Phase 0 — Foundation

- Initialize monorepo/repository structure.
- Configure package manager.
- Configure Node/React tooling.
- Configure ESLint and formatting.
- Add `.gitignore`.
- Add `.env.example`.
- Add Docker/test environment if selected.
- Add CI skeleton.
- Add `npm run verify`.
- Add health/readiness endpoints.
- Add baseline tests.

**Gate:** clean install + lint + test + build pass.

## Phase 1 — Backend foundation

- Express app.
- Configuration loader.
- MongoDB connection.
- Error classes/middleware.
- Request validation.
- User model.
- Authentication service.
- Auth routes.
- Auth tests.

**Gate:** auth API integration tests pass.

## Phase 2 — Conversation/message domain

- Conversation model.
- Message model.
- Indexes.
- Conversation service.
- Message service.
- REST routes.
- Authorization tests.
- Pagination tests.

**Gate:** all message/conversation API tests pass.

## Phase 3 — Socket.IO

- Socket server.
- JWT handshake authentication.
- Event validation.
- Conversation join authorization.
- Message send/ack.
- Broadcast.
- Presence.
- Typing.
- Read state.
- Reconnection/resync.

**Gate:** Socket.IO integration suite passes.

## Phase 4 — Frontend

- App shell.
- Auth pages.
- Auth state.
- API client.
- Socket client.
- Conversation list.
- Chat UI.
- Composer.
- Presence.
- Typing.
- Error/reconnect UI.

**Gate:** frontend tests + build pass.

## Phase 5 — E2E

Automate:

- two-user public chat
- two-user private chat
- history after refresh
- unauthorized private access
- reconnect behavior
- invalid authentication

**Gate:** E2E suite passes in CI.

## Phase 6 — Hardening

- Rate limiting.
- Security headers.
- CORS review.
- Payload limits.
- Secret scan.
- Dependency audit.
- Logging review.
- Index verification.
- Graceful shutdown.
- Failure-path tests.

**Gate:** security/quality checks pass.

## Phase 7 — Finalization

- README.
- Architecture diagram.
- API documentation.
- WebSocket contract.
- Screenshots/demo.
- Deployment configuration.
- Resume claims verified against actual implementation.
- Final `npm run verify`.

## Rule

Never start the next phase if the current phase's gate is failing, unless the failure is explicitly documented as a known non-blocking issue.
