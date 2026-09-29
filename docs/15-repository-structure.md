# Repository Structure

npm workspaces (no monorepo framework). This is the actual layout; folders are
added as phases need them rather than created empty.

```text
.
├── apps/
│   ├── client/                    # React 19 + Vite 8 (workspace @realtime-chat/client)
│   │   ├── index.html
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── config/            # validated VITE_* configuration
│   │   │   ├── features/system/   # backend status page
│   │   │   ├── services/api/      # REST boundary (httpClient, systemApi)
│   │   │   ├── services/socket/   # Socket.IO boundary (socketClient)
│   │   │   ├── App.jsx
│   │   │   ├── index.css
│   │   │   └── main.jsx
│   │   ├── tests/                 # Vitest + Testing Library (jsdom)
│   │   ├── vite.config.js         # also holds the Vitest config
│   │   └── package.json
│   └── server/                    # Express 5 + Socket.IO 4 + Mongoose 9 (workspace @realtime-chat/server)
│       ├── src/
│       │   ├── config/            # env validation, database connection
│       │   ├── controllers/
│       │   ├── middleware/
│       │   ├── routes/
│       │   ├── services/
│       │   ├── sockets/           # server factory, bindEvent, handlers/, middleware/
│       │   ├── utils/
│       │   ├── validators/
│       │   ├── app.js             # Express app factory (no I/O)
│       │   ├── server.js          # startServer(): lifecycle
│       │   └── index.js           # process entry point
│       ├── tests/
│       │   ├── helpers/
│       │   ├── unit/              # no database
│       │   └── integration/       # real in-memory MongoDB, HTTP, Socket.IO, child process
│       ├── vitest.config.js       # "unit" and "integration" projects
│       └── package.json
├── docs/
├── e2e/                           # Playwright specs
├── scripts/
│   ├── check-secrets.js           # secret scan
│   ├── e2e-backend.js             # backend + ephemeral MongoDB for E2E
│   └── verify.js                  # npm run verify
├── .github/workflows/ci.yml
├── .env.example
├── .env.test.example
├── .gitattributes                 # LF line endings
├── .gitignore
├── .nvmrc
├── .prettierrc.json / .prettierignore
├── eslint.config.js               # single flat config for the whole repo
├── playwright.config.js
├── package.json                   # workspaces + root scripts
├── README.md
└── CLAUDE.md
```

`models/` and `repositories/` are added to `apps/server/src` with the first
model (Phase 1); `pages/`, `components/`, `hooks/`, `context/` are added to the
client when the chat UI arrives (Phase 4).

## Root scripts

| Script                     | What it does                                                             |
| -------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`              | server (`node --watch`) + Vite dev server, via `concurrently`            |
| `npm run lint`             | ESLint over the whole repository                                         |
| `npm run format`           | Prettier write                                                           |
| `npm run format:check`     | Prettier check                                                           |
| `npm run test`             | `test:unit` then `test:integration`                                      |
| `npm run test:unit`        | server unit tests + client component/unit tests                          |
| `npm run test:integration` | server integration + Socket.IO + process smoke tests (in-memory MongoDB) |
| `npm run test:e2e`         | Playwright (builds client, starts backend + ephemeral DB automatically)  |
| `npm run build`            | production client build (`apps/client/dist`)                             |
| `npm run security`         | `security:audit` (npm audit, high+) and `security:secrets`               |
| `npm run verify`           | every gate above, in order, fail-fast, with a summary                    |

The server has no build step (plain Node.js ESM).
