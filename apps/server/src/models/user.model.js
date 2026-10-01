import { Schema } from 'mongoose'

export const USER_NAME_MAX_LENGTH = 50
export const EMAIL_MAX_LENGTH = 254

/** Lower-cases and trims an email so uniqueness is case-insensitive. */
export function normalizeEmail(email) {
  return String(email).trim().toLowerCase()
}

export const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: USER_NAME_MAX_LENGTH,
    },
    email: {
      type: String,
      required: true,
      maxlength: EMAIL_MAX_LENGTH,
      set: normalizeEmail,
    },
    // Argon2id PHC string. Never selected unless explicitly requested.
    passwordHash: { type: String, required: true, select: false },
    lastSeenAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    strict: 'throw',
    // Indexes are created explicitly at startup (see ensureIndexes).
    autoIndex: false,
  },
)

userSchema.index({ email: 1 }, { unique: true, name: 'email_unique' })

/** Returns the User model bound to `connection` (registered once). */
export function getUserModel(connection) {
  return connection.models.User ?? connection.model('User', userSchema)
}

/**
 * The only shape in which a user leaves the server. Built field-by-field so
 * new schema fields (and passwordHash) are never exposed by accident.
 */
export function toPublicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  }
}
