# Definition of Done

A task is DONE only when all applicable conditions are true.

## Code

- [ ] Implementation is complete.
- [ ] No TODO placeholders remain for required behavior.
- [ ] No dead code introduced.
- [ ] No debug logging.
- [ ] No secrets or credentials.
- [ ] No hard-coded production hosts.

## Tests

- [ ] Happy path tested.
- [ ] Validation failure tested.
- [ ] Authorization failure tested.
- [ ] Persistence tested.
- [ ] Relevant Socket.IO behavior tested.
- [ ] Regression test added for bugs.

## Quality

- [ ] Formatter passes.
- [ ] Linter passes.
- [ ] Type checks pass if used.
- [ ] Build passes.
- [ ] No new warnings that indicate real defects.

## Security

- [ ] Authentication enforced.
- [ ] Authorization enforced.
- [ ] Inputs validated.
- [ ] Payload limits enforced.
- [ ] Sensitive data excluded from logs/responses.
- [ ] CORS/security configuration reviewed.

### UI checks (from Phase 4)

- [ ] New UI works at 320px and on large screens without horizontal scrolling (E2E asserts overflow).
- [ ] Interactive elements have accessible names; state is never conveyed by colour alone; motion respects `prefers-reduced-motion`.
- [ ] Data hooks pass request errors to `handleAuthError` so an expired session returns to sign-in.
- [ ] New tests for behaviour are mutation-checked: they fail when the behaviour is removed.

### Real-time checks (from Phase 3)

- [ ] New socket events are registered through `on()` (validation, acks, rate limits) and authorize with the same service rule as REST.
- [ ] Durable events persist before anything is emitted; tests prove failures emit nothing.
- [ ] Emits target a room (`conversation:`, `user:`, `session:` via `sockets/rooms.js`); no `io.emit` for private data.
- [ ] Client code subscribes through `useRealtimeEvent` (no direct `socket.on` in components) and tests check listener counts.
- [ ] Real-time tests wait on events/barriers or UI state, never on fixed sleeps.

### Conversation/message checks (from Phase 2)

- [ ] Every `/conversations/:id/...` route applies `authorize(conversationAccess(...))`; handlers use `req.conversation`, never a client-supplied conversation or user id.
- [ ] Non-members get the same `404 CONVERSATION_NOT_FOUND` as for unknown ids (tested).
- [ ] Every list query is keyset-paginated with a bounded `limit`; no offset/skip pagination and no unbounded `find`.
- [ ] New queries are backed by an intentional index (verified with an `explain()` or index test where it matters).
- [ ] Uniqueness that matters (private pair, public room, retry dedup) is enforced by a unique index, not only by application checks.

### Authentication-specific checks (from Phase 1)

- [ ] Protected routes use the shared `authenticate` middleware (and `authorize(policy)` for resource access); no controller re-implements auth.
- [ ] Identity is taken from `req.auth` / `socket.data.auth` only, never from request payloads.
- [ ] Responses expose users only through `toPublicUser`; tests assert no `passwordHash`, token or secret in bodies and logs.
- [ ] New state-changing endpoints are covered by the Origin check (mounted under `/api`).
- [ ] New tests use generated secrets and `example.test` users, never real credentials.

## Documentation

- [ ] API contract updated.
- [ ] Socket event contract updated.
- [ ] Environment variables documented.
- [ ] README updated if setup/behavior changed.

## Automation

- [ ] CI covers the new behavior.
- [ ] `npm run verify` passes.
- [ ] E2E coverage exists for critical user-facing behavior.

## Final reporting

Claude must report:

- files changed
- behavior implemented
- tests run
- test counts/results
- build result
- known limitations
- follow-up work, if any
