/**
 * Socket event handler modules. Each module is a function receiving
 * `{ io, socket, logger, on }` for one connected socket, where
 * `on(event, handler)` binds an event with validation-friendly centralized
 * error handling (see ../bindEvent.js).
 *
 * No events are registered in Phase 0. Chat events defined in
 * docs/06-websocket-protocol.md are added here as separate modules from Phase 3.
 */
export const defaultHandlers = []
