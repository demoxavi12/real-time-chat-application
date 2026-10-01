import { randomUUID } from 'node:crypto'
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose'
import { AppError, ErrorCodes } from '../utils/AppError.js'

export const JWT_ALGORITHM = 'HS256'
export const JWT_ISSUER = 'realtime-chat-api'
export const JWT_AUDIENCE = 'realtime-chat-client'

const invalid = () =>
  new AppError(
    401,
    ErrorCodes.AUTHENTICATION_INVALID,
    'Authentication is invalid or has expired',
  )

/**
 * Issues and verifies session JWTs.
 *
 * Claims: sub (user id), sid (session id, stable across renewals),
 * auth_time (session start, seconds), iat, exp, iss, aud.
 * Verification pins the algorithm, issuer and audience, so tokens signed with
 * `alg: none`, another algorithm or for another service are rejected.
 */
export function createTokenService({
  secret,
  tokenTtlMs,
  sessionMaxAgeMs,
  now = () => Date.now(),
}) {
  const key = new TextEncoder().encode(secret)
  const seconds = (ms) => Math.floor(ms / 1000)

  /** Hard end of a session: no token for it may outlive this (seconds). */
  const sessionEnd = (authTime) => authTime + seconds(sessionMaxAgeMs)

  async function sign({ userId, sessionId, authTime }) {
    const iat = seconds(now())
    const exp = Math.min(iat + seconds(tokenTtlMs), sessionEnd(authTime))
    const token = await new SignJWT({ sid: sessionId, auth_time: authTime })
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: 'JWT' })
      .setSubject(String(userId))
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(key)
    return { token, expiresAt: new Date(exp * 1000) }
  }

  return {
    /** Starts a new session for `userId`. */
    issue(userId) {
      return sign({
        userId,
        sessionId: randomUUID(),
        authTime: seconds(now()),
      })
    },

    /**
     * Sliding renewal: once less than half of the token lifetime remains,
     * returns a fresh token for the same session (never past the session's
     * absolute maximum age). Returns null when no renewal is due/possible.
     */
    async renew(claims) {
      const remaining = claims.exp - seconds(now())
      if (remaining > seconds(tokenTtlMs) / 2) return null
      if (sessionEnd(claims.authTime) <= seconds(now())) return null
      return sign(claims)
    },

    /** Returns verified claims or throws AUTHENTICATION_INVALID. */
    async verify(token) {
      let payload
      try {
        ;({ payload } = await jwtVerify(token, key, {
          algorithms: [JWT_ALGORITHM],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          requiredClaims: ['sub', 'sid', 'auth_time', 'iat', 'exp'],
          currentDate: new Date(now()),
        }))
      } catch (error) {
        if (error instanceof joseErrors.JOSEError) throw invalid()
        throw error
      }
      if (
        typeof payload.sid !== 'string' ||
        !Number.isInteger(payload.auth_time) ||
        sessionEnd(payload.auth_time) <= seconds(now())
      ) {
        throw invalid()
      }
      return {
        userId: payload.sub,
        sessionId: payload.sid,
        authTime: payload.auth_time,
        exp: payload.exp,
      }
    },

    /** When the session behind `claims` ends at the latest. */
    sessionExpiresAt(claims) {
      return new Date(sessionEnd(claims.authTime) * 1000)
    },
  }
}
