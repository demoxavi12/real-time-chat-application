import { ErrorCodes } from '../../utils/AppError.js'
import { createWindowCounter } from '../rateLimit.js'

/**
 * Limits new Socket.IO connections per client IP and window (runs before
 * authentication, so floods never reach the database). Behind a reverse
 * proxy the proxy's address is seen until trust-proxy handling is added.
 */
export function createConnectionRateLimit({ windowMs, connectionLimit }) {
  const counter = createWindowCounter({ windowMs, max: connectionLimit })
  return (socket, next) => {
    if (counter.consume(socket.handshake.address)) {
      next()
      return
    }
    const error = new Error(ErrorCodes.RATE_LIMITED)
    error.data = { code: ErrorCodes.RATE_LIMITED, message: 'Too many requests' }
    next(error)
  }
}
