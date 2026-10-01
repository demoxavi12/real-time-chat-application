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

    /** Names for a bounded set of ids (participants/senders of one page). */
    findNamesByIds(ids) {
      return User.find({ _id: { $in: ids } })
        .select('name')
        .lean()
        .exec()
    },

    /**
     * Directory search for other users, ordered by _id (keyset pagination).
     * `q` containing "@" is an exact (normalized, indexed) email match;
     * otherwise a case-insensitive name prefix. The prefix is regex-escaped
     * and anchored (no user-controlled patterns, no ReDoS) and the query is
     * bounded by `limit` and a server-side time limit.
     */
    search({ excludeId, q, afterId, limit }) {
      const filter = {
        _id: { $ne: excludeId, ...(afterId && { $gt: afterId }) },
      }
      if (q?.includes('@')) {
        filter.email = normalizeEmail(q)
      } else if (q) {
        filter.name = { $regex: `^${escapeRegExp(q)}`, $options: 'i' }
      }
      return User.find(filter)
        .sort({ _id: 1 })
        .limit(limit)
        .select('name')
        .maxTimeMS(SEARCH_TIME_LIMIT_MS)
        .lean()
        .exec()
    },
  }
}

const SEARCH_TIME_LIMIT_MS = 2000

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
