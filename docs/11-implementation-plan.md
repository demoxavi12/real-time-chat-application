# Implementation Plan

## Status

| Phase                                   | State                                                                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 — Foundation                          | **Done** (commit `cce0410`)                                                                                                                                                                                                                |
| 1 — Backend foundation + authentication | **Done**: auth API, User model, sessions, frontend auth UI, Socket.IO handshake auth, tests (see below)                                                                                                                                    |
| 2 — Conversation/message domain         | **Done**: models + indexes, users directory, public room, private conversations, REST messages, cursor history, authorization, minimal REST chat UI, tests                                                                                 |
| 3 — Socket.IO                           | **Done**: authenticated sockets, room authorization, message:send/ack/broadcast with dedup, conversation updates, presence, typing, read state, revocation, rate limits, reconnect/resync, frontend realtime layer, tests                  |
| 4 — Frontend UX                         | **Done**: list previews/activity time/presence, grouped messages with day dividers, Sent/Seen, scroll management + "New messages", mobile single-pane layout with back navigation, session-expiry notice, focus management, reduced motion |
| 5 — E2E                                 | **Done**: 10+ cross-user flows on desktop + Pixel 7 (incl. send failure → retry, duplicate send, mobile navigation, session expiry, 320px/1920px), stress-tested with `--repeat-each=5`                                                    |
| 6 — Hardening                           | **Done**: `TRUST_PROXY` (REST + sockets), https-only production origins, 0 audit vulnerabilities, secret scan, explain-plan index tests, graceful shutdown, failure-path tests                                                             |
| 7 — Finalization                        | **Done**: README and all docs synchronized, ADR-034–036, final `npm run verify`                                                                                                                                                            |

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

**Delivered beyond the original Phase 1 list** (pulled forward so
authentication is usable end to end): login/register UI, auth state and
protected routes (Phase 4 items), Socket.IO handshake authentication
(Phase 3 item), authentication E2E tests (Phase 5 item), auth rate limiting
(Phase 6 item). Chat-related parts of those phases remain open.

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

**Delivered:** see `05-api-spec.md` (Users, Conversations, Messages). Also
pulled forward from Phase 4: a minimal REST-only chat UI (conversation list,
user search, history with "load older", composer) so the data layer is
exercised end to end in E2E. Real-time delivery, presence, typing and read
receipts remain Phase 3.

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

**Delivered:** see `06-websocket-protocol.md` (implemented contract). The
frontend real-time layer (live messages, typing, receipts, presence,
connection state, reconnect resync) was pulled forward from Phase 4.

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
