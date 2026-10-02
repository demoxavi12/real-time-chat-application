import { toPublicUser } from '../models/user.model.js'
import { sendSuccess } from '../utils/response.js'

export function createAuthController({ authService, authCookie, realtime }) {
  return {
    async register(req, res) {
      const session = await authService.register(req.validated.body)
      authCookie.set(res, session.token, session.expiresAt)
      sendSuccess(res, { user: toPublicUser(session.user) }, 201)
    },

    async login(req, res) {
      const session = await authService.login(req.validated.body)
      authCookie.set(res, session.token, session.expiresAt)
      sendSuccess(res, { user: toPublicUser(session.user) })
    },

    me(req, res) {
      sendSuccess(res, { user: toPublicUser(req.auth.user) })
    },

    /**
     * Idempotent: revokes the session if one is presented (and disconnects
     * its live sockets), always clears the cookie.
     */
    async logout(req, res) {
      const sessionId = await authService.logout(
        authCookie.read(req.headers.cookie),
      )
      realtime.sessionRevoked(sessionId)
      authCookie.clear(res)
      sendSuccess(res, { loggedOut: true })
    },
  }
}
