import { createChatHandlers } from './chat.handlers.js'

/**
 * Socket event handler modules. Each module is a function receiving
 * `{ io, socket, logger, on }` for one connected, authenticated socket, where
 * `on(event, handler, options)` binds an event with validation-friendly
 * centralized error handling and rate limiting (see ../bindEvent.js).
 */
export function createDefaultHandlers(deps) {
  return [createChatHandlers(deps)]
}
