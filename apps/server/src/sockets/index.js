import { Server } from 'socket.io'
import { bindEvent } from './bindEvent.js'
import { defaultHandlers } from './handlers/index.js'

// Matches the HTTP JSON body limit; chat payloads are bounded far lower later.
const MAX_SOCKET_PAYLOAD_BYTES = 100 * 1024

/**
 * Attaches Socket.IO to an HTTP server. `middlewares` (handshake, e.g. auth)
 * are required so a server can never start without them by accident;
 * `handlers` default to the application registry. Both are injectable for
 * tests.
 */
export function createSocketServer(
  httpServer,
  { config, logger, middlewares, handlers = defaultHandlers },
) {
  if (!Array.isArray(middlewares)) {
    throw new TypeError('createSocketServer requires a middlewares array')
  }
  const allowedOrigins = new Set(config.clientOrigins)
  const io = new Server(httpServer, {
    cors: { origin: [...config.clientOrigins], credentials: true },
    maxHttpBufferSize: MAX_SOCKET_PAYLOAD_BYTES,
    serveClient: false,
    // CORS does not apply to WebSocket upgrades, so browsers would attach the
    // session cookie to a cross-site upgrade (Cross-Site WebSocket
    // Hijacking). Reject any request whose Origin is not an allowed client.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin
      callback(null, !origin || allowedOrigins.has(origin))
    },
  })

  for (const middleware of middlewares) io.use(middleware)

  io.on('connection', (socket) => {
    logger.debug('socket connected', { socketId: socket.id })
    socket.on('disconnect', (reason) => {
      logger.debug('socket disconnected', { socketId: socket.id, reason })
    })

    const context = {
      io,
      socket,
      logger,
      on: (event, handler) => bindEvent({ socket, logger }, event, handler),
    }
    for (const register of handlers) register(context)
  })

  return io
}
