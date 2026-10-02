import { DuplicateEmailError } from '../repositories/user.repository.js'
import { AppError, ErrorCodes } from '../utils/AppError.js'
import {
  hashPassword,
  verifyAgainstDummyHash,
  verifyPassword,
} from './password.service.js'

const invalidCredentials = () =>
  new AppError(
    401,
    ErrorCodes.INVALID_CREDENTIALS,
    'Email or password is incorrect',
  )

const invalidAuthentication = () =>
  new AppError(
    401,
    ErrorCodes.AUTHENTICATION_INVALID,
    'Authentication is invalid or has expired',
  )

/**
 * Authentication use cases. Shared by REST middleware/controllers and the
 * Socket.IO handshake so both transports authenticate identically. Identity
 * always comes from verified credentials or a verified token, never from
 * client-supplied ids.
 */
export function createAuthService({ users, revokedSessions, tokens }) {
  async function startSession(user) {
    const session = await tokens.issue(user._id)
    return { user, ...session }
  }

  return {
    async register({ name, email, password }) {
      const passwordHash = await hashPassword(password)
      try {
        const user = await users.create({ name, email, passwordHash })
        return startSession(user)
      } catch (error) {
        if (error instanceof DuplicateEmailError) {
          throw new AppError(
            409,
            ErrorCodes.EMAIL_ALREADY_EXISTS,
            'An account with this email already exists',
          )
        }
        throw error
      }
    },

    async login({ email, password }) {
      const user = await users.findByEmailWithPassword(email)
      if (!user) {
        await verifyAgainstDummyHash(password)
        throw invalidCredentials()
      }
      if (!(await verifyPassword(user.passwordHash, password))) {
        throw invalidCredentials()
      }
      await users.touchLastSeen(user._id)
      return startSession(user)
    },

    /**
     * Resolves a token to `{ user, claims, renewal, sessionExpiresAt }`. Rejects tokens that are
     * forged, expired, revoked, or whose user no longer exists.
     */
    async authenticate(token) {
      const claims = await tokens.verify(token)
      const [user, revoked] = await Promise.all([
        users.findById(claims.userId),
        revokedSessions.isRevoked(claims.sessionId),
      ])
      if (!user || revoked) throw invalidAuthentication()
      const renewal = await tokens.renew(claims)
      return {
        user,
        claims,
        renewal,
        sessionExpiresAt: tokens.sessionExpiresAt(claims),
      }
    },

    /**
     * Revokes the session behind `token` if it is valid; otherwise no-op.
     * Returns the revoked session id (or null) so live sockets can be closed.
     */
    async logout(token) {
      if (!token) return null
      let claims
      try {
        claims = await tokens.verify(token)
      } catch (error) {
        if (error instanceof AppError) return null
        throw error
      }
      await revokedSessions.revoke(
        claims.sessionId,
        tokens.sessionExpiresAt(claims),
      )
      return claims.sessionId
    },
  }
}
