import mongoose from 'mongoose'
import { withTimeout } from '../utils/withTimeout.js'

export class DatabaseConnectionError extends Error {
  constructor(cause) {
    super(`Could not connect to MongoDB: ${cause.message}`, { cause })
    this.name = 'DatabaseConnectionError'
  }
}

/**
 * Owns a single Mongoose connection. Models are registered on
 * `database.connection` (e.g. `database.connection.model('User', schema)`)
 * rather than on the global mongoose singleton, which keeps the app free of
 * hidden global state and lets tests run isolated servers side by side.
 */
export function createDatabase({
  uri,
  logger,
  serverSelectionTimeoutMS = 5000,
}) {
  let connection = null
  const onDisconnected = () => logger.warn('database disconnected')

  return {
    get connection() {
      if (!connection) throw new Error('Database is not connected')
      return connection
    },

    async connect() {
      if (connection) return connection
      const conn = mongoose.createConnection(uri, {
        serverSelectionTimeoutMS,
        // Fail fast instead of silently queueing queries while disconnected.
        bufferCommands: false,
      })
      conn.on('disconnected', onDisconnected)
      conn.on('reconnected', () => logger.info('database reconnected'))
      conn.on('error', (err) => logger.error('database error', { err }))
      try {
        await conn.asPromise()
      } catch (error) {
        await conn.close(true)
        throw new DatabaseConnectionError(error)
      }
      connection = conn
      logger.info('database connected', { database: conn.name })
      return conn
    },

    /** Resolves when MongoDB answers a ping; rejects otherwise. */
    async ping({ timeoutMs = 2000 } = {}) {
      if (!connection || connection.readyState !== 1) {
        throw new Error('Database is not connected')
      }
      await withTimeout(connection.db.admin().ping(), timeoutMs)
    },

    async disconnect() {
      if (!connection) return
      const conn = connection
      connection = null
      // A planned close is not an outage; only unexpected drops are warned.
      conn.off('disconnected', onDisconnected)
      await conn.close()
      logger.info('database connection closed')
    },
  }
}
