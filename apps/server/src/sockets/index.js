import { Server } from 'socket.io'
import { bindEvent } from './bindEvent.js'
import { defaultHandlers } from './handlers/index.js'
import { defaultMiddlewares } from './middleware/index.js'

// Matches the HTTP JSON body limit; chat payloads are bounded far lower later.
const MAX_SOCKET_PAYLOAD_BYTES = 100 * 1024

/**
 * Attaches Socket.IO to an HTTP server. `middlewares` and `handlers` default
 * to the application registries and are injectable for tests.
 */
export function createSocketServer(
  httpServer,
  {
    config,
    logger,
    middlewares = defaultMiddlewares,
    handlers = defaultHandlers,
  },
) {
  const io = new Server(httpServer, {
    cors: { origin: [...config.clientOrigins], credentials: true },
    maxHttpBufferSize: MAX_SOCKET_PAYLOAD_BYTES,
    serveClient: false,
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
