import { createSocketAuthMiddleware } from './authenticate.js'

/**
 * Socket.IO connection middlewares, applied in order via `io.use()`.
 * Signature: `(socket, next) => void`; call `next(err)` to reject the
 * handshake. Every connection must authenticate (same session as REST).
 */
export function createDefaultMiddlewares({ authService, authCookie, logger }) {
  return [createSocketAuthMiddleware({ authService, authCookie, logger })]
}
