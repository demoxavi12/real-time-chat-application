export function createRevokedSessionRepository({ RevokedSession }) {
  return {
    /** Idempotent: revoking an already revoked session is a no-op. */
    async revoke(sessionId, expiresAt) {
      await RevokedSession.updateOne(
        { sessionId },
        { $setOnInsert: { sessionId, expiresAt } },
        { upsert: true },
      ).exec()
    },

    async isRevoked(sessionId) {
      return (await RevokedSession.exists({ sessionId })) !== null
    },
  }
}
