import http from 'node:http'
import { createApp } from './app.js'
import { createDatabase } from './config/database.js'
import { createReadinessService } from './services/readiness.service.js'
import { createSocketServer } from './sockets/index.js'

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

/**
 * Connects to MongoDB, then starts HTTP + Socket.IO. Resolves with handles
 * and an idempotent `close()` for graceful shutdown. Throws (after cleaning
 * up) if any step fails.
 */
export async function startServer({ config, logger, socket = {} }) {
  const database = createDatabase({ uri: config.mongodbUri, logger })
  await database.connect()

  const readiness = createReadinessService({ database: () => database.ping() })
  const app = createApp({ config, logger, readiness })
  const httpServer = http.createServer(app)
  const io = createSocketServer(httpServer, { config, logger, ...socket })

  try {
    await listen(httpServer, config.port)
  } catch (error) {
    await database.disconnect()
    throw error
  }

  let closing
  function close() {
    closing ??= (async () => {
      logger.info('shutting down')
      // Disconnects every socket, then closes the HTTP server (which also
      // drops idle keep-alive connections and lets in-flight requests finish).
      await new Promise((resolve) => io.close(() => resolve()))
      await database.disconnect()
      logger.info('shutdown complete')
    })()
    return closing
  }

  return {
    app,
    httpServer,
    io,
    database,
    port: httpServer.address().port,
    close,
  }
}
