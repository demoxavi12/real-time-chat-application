# Claude Code Operating Rules

This file is the operating contract for an AI coding agent working on this project.

## 1. Mission

Build the application described by the project documentation while maximizing automation and minimizing manual verification.

## 2. Before changing code

Claude must:

1. Read `00-project-charter.md`.
2. Read the relevant phase in `11-implementation-plan.md`.
3. Read the relevant architecture/API/socket/security document.
4. Inspect the existing repository.
5. Identify existing tests and scripts.
6. State a concise implementation plan before large changes.

## 3. Never guess repository state

Before modifying:

- inspect package.json files
- inspect source structure
- inspect existing configuration
- inspect Git status
- inspect existing tests

Do not overwrite working code merely because a desired file is missing.

## 4. Incremental implementation

For each feature:

```text
implementation
→ focused tests
→ lint
→ relevant integration tests
→ build
```

## 5. Server-authoritative rules

Never:

- trust client senderId
- trust client authorization claims
- allow arbitrary socket room joins
- persist client timestamps as authoritative
- expose sensitive user fields

## 6. Automated verification

After meaningful changes, run the strongest relevant automated checks.

At minimum before phase completion:

```bash
npm run lint
npm run test
npm run build
npm run verify
```

Run E2E when user-facing behavior changes.

## 7. Failure handling

If a command fails:

- capture the real error
- identify root cause
- fix it
- rerun the failed command
- rerun dependent checks

Never:

- suppress errors
- skip tests without documenting why
- claim success without evidence
- use fake test credentials in committed code
- replace tests with manual instructions

## 8. Scope control

Do not add:

- unnecessary libraries
- unnecessary microservices
- speculative abstractions
- features outside the current phase

Prefer boring, testable architecture.

## 9. Documentation synchronization

When behavior changes:

- update API docs
- update socket contract
- update architecture if boundaries change
- update README/setup instructions
- add/update tests

## 10. Git hygiene

Before completion:

```bash
git status
git diff --check
git diff
```

Check for:

- secrets
- generated junk
- debug code
- accidental large files
- test credentials
- environment files

Do not commit automatically unless explicitly requested.

## 11. Final response format

Claude must finish with:

### Implemented

- ...

### Verification

- Lint: PASS/FAIL
- Unit: PASS/FAIL + count
- Integration: PASS/FAIL + count
- E2E: PASS/FAIL + count
- Build: PASS/FAIL
- Security checks: PASS/FAIL

### Files changed

- ...

### Known issues

- ...

### Next phase

- ...

Do not say "looks good" as a substitute for test results.
