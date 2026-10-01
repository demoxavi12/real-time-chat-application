/**
 * Starts the real backend against a throw-away in-memory MongoDB for E2E runs.
 * Playwright launches this as a webServer, waits for GET /ready to return 200,
 * and terminates it when the run finishes. No developer database or .env file
 * is ever used. Backend logs go to e2e-logs/backend.log (uploaded by CI).
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { loadConfig } from '../apps/server/src/config/env.js'
import { startServer } from '../apps/server/src/server.js'
import { createLogger } from '../apps/server/src/utils/logger.js'

const port = process.env.E2E_API_PORT ?? '5100'
const clientOrigin = process.env.E2E_CLIENT_ORIGIN ?? 'http://127.0.0.1:4173'

fs.mkdirSync('e2e-logs', { recursive: true })
const logStream = fs.createWriteStream('e2e-logs/backend.log', { flags: 'w' })

const mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } })

let server
try {
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: port,
    MONGODB_URI: mongo.getUri('realtime_chat_e2e'),
    CLIENT_ORIGIN: clientOrigin,
    LOG_LEVEL: 'info',
    // Fresh signing key per run: nothing secret is stored anywhere.
    JWT_SECRET: randomBytes(48).toString('hex'),
    // Every E2E user signs up from 127.0.0.1; rate limiting itself is covered
    // by the server integration tests.
    RATE_LIMIT_MAX: '10000',
    AUTH_RATE_LIMIT_MAX: '10000',
  })
  server = await startServer({
    config,
    logger: createLogger({ level: config.logLevel, stream: logStream }),
  })
} catch (error) {
  console.error('E2E backend failed to start:', error.message)
  await mongo.stop({ doCleanup: true, force: true })
  process.exit(1)
}

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  try {
    await server.close()
  } finally {
    await mongo.stop({ doCleanup: true, force: true })
    process.exit(0)
  }
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
