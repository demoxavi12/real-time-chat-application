import { SignJWT } from 'jose'
import { inject } from 'vitest'
import { startServer } from '../../src/server.js'
import { JWT_AUDIENCE, JWT_ISSUER } from '../../src/services/token.service.js'
import {
  createMemoryLogger,
  testConfig,
  testJwtSecret,
  uniqueDbName,
  withDatabase,
} from './testEnv.js'

/**
 * Starts a real server on an isolated database of the run's ephemeral
 * MongoDB. Auth and Socket.IO rate limits are relaxed unless a test overrides
 * them (all test traffic comes from 127.0.0.1); the limits themselves are
 * tested with explicit low values.
 */
export async function startTestServer(env = {}) {
  const { logger, lines } = createMemoryLogger('debug')
  const server = await startServer({
    config: testConfig({
      MONGODB_URI: withDatabase(inject('mongoUri'), uniqueDbName('auth')),
      AUTH_RATE_LIMIT_MAX: '1000',
      SOCKET_CONNECTION_RATE_LIMIT: '10000',
      SOCKET_EVENT_RATE_LIMIT: '10000',
      SOCKET_MESSAGE_RATE_LIMIT: '10000',
      SOCKET_INVALID_EVENT_LIMIT: '10000',
      ...env,
    }),
    logger,
  })
  return { server, url: `http://127.0.0.1:${server.port}`, logLines: lines }
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/**
 * Signs an arbitrary session JWT, for attack and edge-case tests (expired,
 * other secret, unknown user...). Defaults produce a currently valid token.
 */
export function craftToken({
  sub,
  sid = 'crafted-session',
  authTime = nowSeconds(),
  iat = nowSeconds(),
  exp = nowSeconds() + 3600,
  secret = testJwtSecret,
  issuer = JWT_ISSUER,
  audience = JWT_AUDIENCE,
} = {}) {
  return new SignJWT({ sid, auth_time: authTime })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret))
}
