import { randomBytes, randomUUID } from 'node:crypto'
import { loadConfig } from '../../src/config/env.js'
import { createAuthenticate } from '../../src/middleware/authenticate.js'
import { createAuthCookie } from '../../src/utils/authCookie.js'
import { createLogger } from '../../src/utils/logger.js'

export const TEST_ORIGIN = 'http://127.0.0.1:4173'

// Generated per test run: no signing secret is ever committed.
export const testJwtSecret = randomBytes(48).toString('hex')

/** A unique database name so test files never share state. */
export function uniqueDbName(prefix = 'test') {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

/** Appends a database name to a base URI such as mongodb://127.0.0.1:1234/ */
export function withDatabase(baseUri, dbName) {
  return `${baseUri.replace(/\/$/, '')}/${dbName}`
}

export function testConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    PORT: '0',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/unit_test_unused',
    CLIENT_ORIGIN: TEST_ORIGIN,
    JWT_SECRET: testJwtSecret,
    ...overrides,
  })
}

export const silentLogger = createLogger({ level: 'silent' })

/** Logger that records entries in memory for assertions. */
export function createMemoryLogger(level = 'debug') {
  const lines = []
  const logger = createLogger({
    level,
    stream: { write: (line) => lines.push(JSON.parse(line)) },
  })
  return { logger, lines }
}

/**
 * Auth dependencies for app-level tests that must not touch authentication:
 * any call into the auth service fails the test loudly.
 */
export function unusedAuth(config = testConfig()) {
  const unexpected = () => {
    throw new Error('authService was not expected to be called in this test')
  }
  const authService = {
    register: unexpected,
    login: unexpected,
    authenticate: unexpected,
    logout: unexpected,
  }
  const authCookie = createAuthCookie(config.auth)
  return {
    authService,
    authCookie,
    authenticate: createAuthenticate({ authService, authCookie }),
  }
}

/** Chat services for app-level tests that must not touch conversations. */
export function unusedChat() {
  const unexpected = () => {
    throw new Error('chat services were not expected to be called in this test')
  }
  const stub = new Proxy({}, { get: () => unexpected })
  return {
    conversationService: stub,
    messageService: stub,
    userDirectory: stub,
  }
}
