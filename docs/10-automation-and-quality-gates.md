# Automation & Quality Gates

The project is designed so routine verification does not depend on the developer manually checking every step.

## Implementation status (Phase 0)

| Gate                           | Implemented as                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| One-command verification       | `npm run verify` → `scripts/verify.js`                                                                                                |
| Formatting                     | Prettier (`format:check`) over code, config and docs                                                                                  |
| Lint                           | ESLint flat config (`no-console` is an error outside `scripts/`)                                                                      |
| Unit / integration / Socket.IO | Vitest; integration uses an ephemeral in-memory MongoDB                                                                               |
| Build                          | `vite build` (the server has no build step)                                                                                           |
| E2E                            | Playwright; starts backend + DB + production client build itself, waits on `/ready`; specs: foundation, auth, chat (desktop + mobile) |
| Dependency audit               | `npm audit --audit-level=high` (fails on high/critical)                                                                               |
| Secret scan                    | `scripts/check-secrets.js` (see below)                                                                                                |
| CI                             | `.github/workflows/ci.yml`                                                                                                            |
| Pre-commit hooks               | **Not added yet** (see section 2)                                                                                                     |

`npm run verify` runs, in order: format check → lint → unit tests (server +
client) → integration + Socket.IO tests → build → E2E → security. It stops at
the first failing gate (later gates depend on earlier ones), prints a
PASS/FAIL/SKIPPED summary with timings, and exits non-zero. Nothing uses
`|| true` or is otherwise ignored. One-time prerequisites: `npm install` and
`npx playwright install chromium`.

**Secret scan.** Scans every file Git would commit (tracked plus untracked,
not ignored) and fails on: committable `.env*` files (except the two
templates) or private-key files; private-key blocks, credentialed MongoDB
URIs, AWS/GitHub/Slack/Google/Stripe/Anthropic/OpenAI key formats, JWTs; and
`*SECRET*/*PASSWORD*/*TOKEN*/*API_KEY*=value` assignments whose value is not an
obvious placeholder (in JS/TS files only quoted string literals count, e.g.
`JWT_SECRET: 'abc…'` or `export const API_TOKEN = "…"`; computed values such
as `JWT_SECRET: randomBytes(48)` are not secrets). It also fails if `.env` is
not git-ignored. Findings
print `file:line` and the rule, never the value. A deliberately fake test
fixture may be exempted by ending that line with `secret-scan:allow` and a
reason, so every exception is visible in review.

**CI** (`push` to `main`, all pull requests; read-only token; cancels
superseded runs):

```text
quality: npm ci -> format:check -> lint -> test:unit -> test:integration
         -> build -> security:audit -> security:secrets
e2e (needs quality): npm ci -> playwright install chromium -> test:e2e
         -> on failure upload playwright-report/, test-results/ (traces,
            screenshots, videos) and e2e-logs/ (backend log)
```

CI has no secrets; all databases are ephemeral on `127.0.0.1`. The MongoDB
binary is cached with `actions/cache`.

## 1. Local one-command verification

Create a root command equivalent to:

```bash
npm run verify
```

It should:

1. Install/verify dependencies when appropriate in CI.
2. Check formatting.
3. Run lint.
4. Run backend unit tests.
5. Run integration tests.
6. Run frontend tests.
7. Build frontend/backend.
8. Run E2E tests when the environment supports them.
9. Produce a concise failure summary.

Do not hide failures with `|| true`.

## 2. Pre-commit automation

Use a Git hook system such as Husky/lint-staged where appropriate.

On commit:

- format staged files
- lint staged files
- run fast unit checks

Do not make commits painfully slow by running the entire E2E suite on every commit.

## 3. CI pipeline

Suggested jobs:

```text
install
  |
lint ----unit -----integration ---> build ---> e2e ---> security checks
```

CI should:

- use a clean environment
- use a temporary/test database
- never use production credentials
- fail on test failures
- upload test reports/artifacts on failure
- verify production build
- verify no accidental secrets are committed

## 4. Automated database lifecycle

For integration/E2E tests:

- start an isolated MongoDB test instance/container
- apply schema/index setup
- seed deterministic test data
- run tests
- clean up automatically

Never point automated tests at production MongoDB.

## 5. Environment validation

Application startup should validate required environment variables and fail with a clear message.

Provide:

```text
.env.example
.env.test.example
```

## 6. Health checks

Implement:

```text
GET /health
GET /ready
```

E2E startup should wait for readiness rather than relying on arbitrary sleep commands.

## 7. Automated API contract checks

Keep request/response examples or schemas synchronized with implementation.

If an API schema tool is introduced, CI should detect breaking contract changes.

## 8. Static security checks

At minimum automate:

- dependency vulnerability audit appropriate to the package manager
- secret scanning
- lint
- unsafe configuration checks

Do not automatically upgrade every dependency during feature work; dependency upgrades should be isolated changes.

## 9. Claude verification protocol

Claude must follow this loop:

```text
PLAN
  ↓
IMPLEMENT
  ↓
FORMAT/LINT
  ↓
UNIT TEST
  ↓
INTEGRATION TEST
  ↓
BUILD
  ↓
E2E
  ↓
SECURITY CHECK
  ↓
REVIEW DIFF
  ↓
UPDATE DOCS
  ↓
REPORT RESULTS
```

If a check fails:

- inspect the actual failure
- fix the root cause
- rerun the failed check
- rerun dependent checks
- never declare success while a required check is red

## 10. No manual-check policy

Claude should proactively create:

- tests
- fixtures
- seed scripts
- health checks
- readiness checks
- E2E flows
- CI workflows
- verification scripts

Manual inspection should be reserved for final product/design review, not correctness verification.
