import http from 'node:http'
import { createApp } from './app.js'
import { createDatabase } from './config/database.js'
import { createAuthenticate } from './middleware/authenticate.js'
import { ensureIndexes, registerModels } from './models/index.js'
import { createConversationRepository } from './repositories/conversation.repository.js'
import { createMessageRepository } from './repositories/message.repository.js'
import { createRevokedSessionRepository } from './repositories/revokedSession.repository.js'
import { createUserRepository } from './repositories/user.repository.js'
import { createAuthService } from './services/auth.service.js'
import { createConversationService } from './services/conversation.service.js'
import { createMessageService } from './services/message.service.js'
import { createReadinessService } from './services/readiness.service.js'
import { createTokenService } from './services/token.service.js'
import { createUserDirectoryService } from './services/userDirectory.service.js'
import { createDefaultHandlers } from './sockets/handlers/index.js'
import { createSocketServer } from './sockets/index.js'
import { createDefaultMiddlewares } from './sockets/middleware/index.js'
import { createPresenceTracker } from './sockets/presence.js'
import { createRealtimeHub } from './sockets/realtime.js'
import { createAuthCookie } from './utils/authCookie.js'

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

/** Composition root for authentication (shared by REST and Socket.IO). */
function createAuth({ config, models }) {
  const tokens = createTokenService({
    secret: config.auth.jwtSecret,
    tokenTtlMs: config.auth.tokenTtlMs,
    sessionMaxAgeMs: config.auth.sessionMaxAgeMs,
  })
  const authService = createAuthService({
    users: createUserRepository(models),
    revokedSessions: createRevokedSessionRepository(models),
    tokens,
  })
  const authCookie = createAuthCookie(config.auth)
  const authenticate = createAuthenticate({ authService, authCookie })
  return { authService, authCookie, authenticate }
}

/** Composition root for conversations, messages and the user directory. */
function createChat({ models }) {
  const users = createUserRepository(models)
  const conversations = createConversationRepository(models)
  return {
    users,
    conversationService: createConversationService({ conversations, users }),
    messageService: createMessageService({
      messages: createMessageRepository(models),
      conversations,
      users,
    }),
    userDirectory: createUserDirectoryService({ users }),
  }
}

/**
 * Connects to MongoDB (and ensures indexes and the public room), then starts HTTP + Socket.IO.
 * Resolves with handles and an idempotent `close()` for graceful shutdown.
 * Throws (after cleaning up) if any step fails.
 */
export async function startServer({ config, logger, socket = {} }) {
  const database = createDatabase({ uri: config.mongodbUri, logger })
  await database.connect()

  let models
  let chat
  try {
    models = registerModels(database.connection)
    await ensureIndexes(models)
    chat = createChat({ models })
    await chat.conversationService.ensurePublicRoom()
  } catch (error) {
    await database.disconnect()
    throw error
  }

  const auth = createAuth({ config, models })
  const readiness = createReadinessService({ database: () => database.ping() })
  const realtime = createRealtimeHub({
    conversationService: chat.conversationService,
    logger,
  })
  const presence = createPresenceTracker()
  const app = createApp({ config, logger, readiness, auth, chat, realtime })
  const httpServer = http.createServer(app)
  const io = createSocketServer(httpServer, {
    config,
    logger,
    middlewares:
      socket.middlewares ??
      createDefaultMiddlewares({ ...auth, logger, limits: config.socket }),
    handlers:
      socket.handlers ??
      createDefaultHandlers({
        conversationService: chat.conversationService,
        messageService: chat.messageService,
        users: chat.users,
        realtime,
        presence,
        logger,
      }),
  })
  realtime.attach(io)

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
    models,
    presence,
    port: httpServer.address().port,
    close,
  }
}
