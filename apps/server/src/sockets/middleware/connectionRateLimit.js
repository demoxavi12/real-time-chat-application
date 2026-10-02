import proxyaddr from 'proxy-addr'
import { ErrorCodes } from '../../utils/AppError.js'
import { createWindowCounter } from '../rateLimit.js'

/**
 * Limits new Socket.IO connections per client IP and window (runs before
 * authentication, so floods never reach the database). With `trustProxy`
 * hops configured the client address is taken from X-Forwarded-For exactly
 * like Express does for REST (proxy-addr); otherwise the socket peer address.
 */
export function createConnectionRateLimit({
  windowMs,
  connectionLimit,
  trustProxy = 0,
}) {
  const counter = createWindowCounter({ windowMs, max: connectionLimit })
  const trust = (_address, hop) => hop < trustProxy
  return (socket, next) => {
    const address =
      trustProxy > 0
        ? proxyaddr(socket.request, trust)
        : socket.handshake.address
    if (counter.consume(address)) {
      next()
      return
    }
    const error = new Error(ErrorCodes.RATE_LIMITED)
    error.data = { code: ErrorCodes.RATE_LIMITED, message: 'Too many requests' }
    next(error)
  }
}
