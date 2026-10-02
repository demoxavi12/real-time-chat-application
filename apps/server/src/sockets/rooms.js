/**
 * The only place Socket.IO room names are built. Prefixes keep the room
 * namespaces apart (a conversation id can never collide with a user id or
 * session id room).
 */
export const conversationRoom = (conversationId) =>
  `conversation:${String(conversationId)}`

/** Every socket of one user (all tabs/devices). */
export const userRoom = (userId) => `user:${String(userId)}`

/** Every socket opened with one login session (used to revoke on logout). */
export const sessionRoom = (sessionId) => `session:${String(sessionId)}`
