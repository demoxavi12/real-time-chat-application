import { toPublicError } from '../utils/AppError.js'

/**
 * Registers `handler` for `event` with centralized error handling.
 *
 * - The handler receives the event payload and returns (or resolves) a result.
 * - If the client supplied an acknowledgement callback it receives
 *   `{ success: true, data }` or `{ success: false, error: { code, message } }`,
 *   mirroring the REST envelope.
 * - Without an ack, failures are emitted to the client as an `error` event.
 * - Unexpected errors are logged and reported as a generic INTERNAL_ERROR so
 *   internal details never reach clients.
 */
export function bindEvent({ socket, logger }, event, handler) {
  socket.on(event, async (...args) => {
    const ack = typeof args.at(-1) === 'function' ? args.pop() : undefined
    try {
      const data = await handler(args[0])
      ack?.({ success: true, data: data ?? null })
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
    }
  })
}
