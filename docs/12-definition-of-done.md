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
