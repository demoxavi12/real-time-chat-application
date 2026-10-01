import { isValidObjectId } from 'mongoose'
import { normalizeEmail } from '../models/user.model.js'

const DUPLICATE_KEY = 11000

export class DuplicateEmailError extends Error {
  constructor() {
    super('Email already registered')
    this.name = 'DuplicateEmailError'
  }
}

/** Data access for users. Every query is by an indexed key (no scans). */
export function createUserRepository({ User }) {
  return {
    async create({ name, email, passwordHash }) {
      try {
        return await User.create({
          name,
          email,
          passwordHash,
          lastSeenAt: new Date(),
        })
      } catch (error) {
        if (error?.code === DUPLICATE_KEY) throw new DuplicateEmailError()
        throw error
      }
    },

    /** Includes passwordHash: only for credential verification. */
    findByEmailWithPassword(email) {
      return User.findOne({ email: normalizeEmail(email) })
        .select('+passwordHash')
        .exec()
    },

    findById(id) {
      if (!isValidObjectId(id)) return Promise.resolve(null)
      return User.findById(id).exec()
    },

    touchLastSeen(id, at = new Date()) {
      return User.updateOne({ _id: id }, { $set: { lastSeenAt: at } }).exec()
    },
  }
}
