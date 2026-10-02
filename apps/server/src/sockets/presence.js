/**
 * Ephemeral presence (docs/04: not durable data): userId -> number of
 * connected, authenticated sockets. A user is online while at least one
 * socket (tab/device) is connected. Process memory is sufficient for the
 * single-instance deployment (ADR-004); a multi-instance setup must move
 * this to a shared store such as Redis.
 */
export function createPresenceTracker() {
  const connections = new Map()

  return {
    /** Returns true when this socket made the user come online. */
    connect(userId) {
      const count = connections.get(userId) ?? 0
      connections.set(userId, count + 1)
      return count === 0
    },

    /** Returns true when this was the user's last socket. */
    disconnect(userId) {
      const count = connections.get(userId) ?? 0
      if (count <= 1) {
        connections.delete(userId)
        return count === 1
      }
      connections.set(userId, count - 1)
      return false
    },

    isOnline: (userId) => connections.has(userId),
    onlineUserIds: () => [...connections.keys()],
  }
}
