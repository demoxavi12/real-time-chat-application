import { AppError, ErrorCodes, toPublicError } from '../utils/AppError.js'

/**
 * Registers `handler` for `event` with centralized error handling.
 *
 * - The handler receives the event payload and returns (or resolves) a result.
 * - If the client supplied an acknowledgement callback it receives
 *   `{ success: true, data }` or `{ success: false, error: { code, message } }`,
 *   mirroring the REST envelope.
 * - Without an ack, a success is emitted as `options.ackEvent` (if given) and
 *   failures are emitted to the client as an `error` event.
 * - Unexpected errors are logged and reported as a generic INTERNAL_ERROR so
 *   internal details never reach clients.
 * - With a `limiter`, every event counts against the per-socket event limit
 *   and `options.limit` (e.g. 'message') against its own limit; exceeding
 *   either answers RATE_LIMITED. Too many invalid payloads disconnect the
 *   socket.
 */
export function bindEvent(
  { socket, logger, limiter },
  event,
  handler,
  options = {},
) {
  const { limit, ackEvent } = options
  socket.on(event, async (...args) => {
    const ack = typeof args.at(-1) === 'function' ? args.pop() : undefined
    try {
      if (
        limiter &&
        (!limiter.consume('event') || (limit && !limiter.consume(limit)))
      ) {
        throw new AppError(429, ErrorCodes.RATE_LIMITED, 'Too many requests')
      }
      const data = await handler(args[0])
      if (ack) ack({ success: true, data: data ?? null })
      else if (ackEvent) socket.emit(ackEvent, data ?? null)
    } catch (error) {
      const { statusCode, body } = toPublicError(error)
      if (statusCode >= 500) {
        logger.error('socket event failed', {
          event,
          socketId: socket.id,
          err: error,
        })
      }
      if (ack) ack({ success: false, error: body })
      else socket.emit('error', body)
      if (
        limiter &&
        body.code === ErrorCodes.VALIDATION_ERROR &&
        !limiter.consume('invalid')
      ) {
        logger.warn('socket disconnected after too many invalid events', {
          socketId: socket.id,
        })
        socket.disconnect(true)
      }
    }
  })
}
