import { Schema } from 'mongoose'

/**
 * Denylist of logged-out session ids. A document only needs to live until the
 * session could no longer be valid anyway, so MongoDB deletes it after
 * `expiresAt` via a TTL index.
 */
export const revokedSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, autoIndex: false },
)

revokedSessionSchema.index(
  { sessionId: 1 },
  { unique: true, name: 'sessionId_unique' },
)
revokedSessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'expiresAt_ttl' },
)

export function getRevokedSessionModel(connection) {
  return (
    connection.models.RevokedSession ??
    connection.model('RevokedSession', revokedSessionSchema)
  )
}
