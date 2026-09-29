# CLAUDE.md — Real-Time Chat Application

Read `docs/14-claude-agent-rules.md` before making implementation changes.

Also read the relevant documentation in `docs/` for the current phase.

## Non-negotiable

- Do not rely on manual verification for routine correctness.
- Add automated tests for every meaningful feature.
- Run lint/tests/build/verification after changes.
- Never suppress failures.
- Never commit secrets or credentials.
- Do not claim a feature is complete without test evidence.
- Keep API, Socket.IO, architecture, security, and README documentation synchronized.

## Current workflow

PLAN → IMPLEMENT → TEST → LINT → BUILD → E2E → SECURITY → DIFF REVIEW → DOC UPDATE → REPORT
