# Environment & Configuration

One `.env` file at the **repository root** serves both apps:

- the server loads it at startup (`process.loadEnvFile`; variables already set
  in the environment take precedence; skipped when `NODE_ENV=test`);
- Vite reads it via `envDir` (only `VITE_*` variables reach the browser).

Copy `.env.example` to `.env` and adjust. `.env` and `.env.*` are git-ignored;
only `.env.example` and `.env.test.example` are committed and contain
placeholders only.

## Server variables

Validated by `apps/server/src/config/env.js` at startup. Every problem is
reported at once and the process exits with code 1. Values are never echoed
in the error (they may contain credentials).

| Variable                    | Required | Default                            | Rules                                                                                           |
| --------------------------- | -------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | no       | `development`                      | `development` \| `test` \| `production`                                                         |
| `PORT`                      | no       | `5000`                             | integer 0–65535                                                                                 |
| `MONGODB_URI`               | **yes**  | —                                  | `mongodb://` or `mongodb+srv://`; must be a loopback host when `NODE_ENV=test`                  |
| `CLIENT_ORIGIN`             | **yes**  | —                                  | comma-separated `http(s)` origins (no paths, no `*`); used by CORS and Socket.IO                |
| `LOG_LEVEL`                 | no       | `info` (`silent` under test)       | `silent` \| `error` \| `warn` \| `info` \| `debug`                                              |
| `RATE_LIMIT_WINDOW_MS`      | no       | `900000` (15 min)                  | positive integer                                                                                |
| `RATE_LIMIT_MAX`            | no       | `300`                              | positive integer, requests per IP per window on `/api/*`                                        |
| `JWT_SECRET`                | **yes**  | —                                  | ≥ 32 characters; the `.env.example` placeholder is rejected; never logged or echoed             |
| `JWT_EXPIRES_IN`            | no       | `1h`                               | duration (`30s`, `15m`, `1h`, `7d`): token lifetime = idle timeout (sliding renewal)            |
| `SESSION_MAX_AGE`           | no       | `7d`                               | duration ≥ `JWT_EXPIRES_IN`: absolute session lifetime after sign-in                            |
| `AUTH_COOKIE_SECURE`        | no       | `true` in production, else `false` | `true`/`false`; `false` is rejected in production. When true the cookie is `__Host-rtc_session` |
| `AUTH_COOKIE_SAMESITE`      | no       | `lax`                              | `lax`, `strict` or `none` (`none` requires Secure)                                              |
| `AUTH_RATE_LIMIT_WINDOW_MS` | no       | `900000` (15 min)                  | positive integer                                                                                |
| `AUTH_RATE_LIMIT_MAX`       | no       | `10`                               | per IP per window: failed logins; registrations                                                 |

## Client variables (public)

Validated by `apps/client/src/config/env.js`, both at runtime and in
`vite.config.js` so a malformed value fails `npm run dev`/`npm run build`.
**Everything here is embedded in the public bundle — never put secrets in
`VITE_*` variables.**

| Variable          | Required | Default                   | Rules                                        |
| ----------------- | -------- | ------------------------- | -------------------------------------------- |
| `VITE_API_URL`    | no       | `/api` (same origin)      | absolute `http(s)` URL or root-relative path |
| `VITE_SOCKET_URL` | no       | page origin (same origin) | absolute `http(s)` URL or root-relative path |

With the defaults, the Vite dev server proxies `/api` and `/socket.io` to
`http://localhost:${PORT}`; in production a reverse proxy can do the same, so
no host names are hard-coded into the build. Set absolute URLs when the API
is deployed on a different origin (it must then be listed in `CLIENT_ORIGIN`).

## Test environments

Automated tests **never read `.env` files** and never need a manually
created database:

- server integration/Socket.IO tests start one ephemeral `mongodb-memory-server`
  instance on `127.0.0.1` (Vitest global setup), give each test file its own
  uniquely named database, and destroy the instance afterwards;
- E2E (`scripts/e2e-backend.js`) does the same and passes all variables
  explicitly;
- `JWT_SECRET` is generated randomly for every test run (`randomBytes(48)`)
  by the Vitest helpers and the E2E backend, so no signing secret is ever
  committed and CI needs no secrets;
- `NODE_ENV=test` refuses any non-loopback `MONGODB_URI` as a second line of
  defence against touching a shared or production database.

`.env.test.example` documents the values the test harnesses use.

## Rules

- `.env` is ignored by Git (enforced by `npm run security:secrets`).
- `.env.example` contains no real secrets.
- Production secrets are configured in the deployment platform.
- Startup validates required variables.
- Test environments never use production databases.
