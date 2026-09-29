import { randomUUID } from 'node:crypto'
import { loadConfig } from '../../src/config/env.js'
import { createLogger } from '../../src/utils/logger.js'

export const TEST_ORIGIN = 'http://127.0.0.1:4173'

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
