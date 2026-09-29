import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigError, loadConfig } from './config/env.js'
import { startServer } from './server.js'
import { createLogger } from './utils/logger.js'

const SHUTDOWN_TIMEOUT_MS = 10_000
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)

// Development convenience: read the repository-root .env. Variables already
// set in the environment win. Automated tests never read .env files.
if (process.env.NODE_ENV !== 'test') {
  try {
    process.loadEnvFile(path.join(repoRoot, '.env'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

async function main() {
  let config
  try {
    config = loadConfig()
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }

  const logger = createLogger({ level: config.logLevel })

  let server
  try {
    server = await startServer({ config, logger })
  } catch (error) {
    logger.error('startup failed', { err: error })
    process.exit(1)
  }
  logger.info('server listening', { port: server.port, env: config.env })

  async function shutdown(reason, exitCode) {
    logger.info('shutdown requested', { reason })
    setTimeout(() => {
      logger.error('shutdown timed out; forcing exit')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS).unref()
    try {
      await server.close()
      process.exit(exitCode)
    } catch (error) {
      logger.error('shutdown failed', { err: error })
      process.exit(1)
    }
  }

  process.once('SIGINT', () => shutdown('SIGINT', 0))
  process.once('SIGTERM', () => shutdown('SIGTERM', 0))
  process.on('unhandledRejection', (error) => {
    logger.error('unhandled promise rejection', { err: error })
    shutdown('unhandledRejection', 1)
  })
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { err: error })
    shutdown('uncaughtException', 1)
  })
}

await main()
