import { parse } from 'cookie'

/**
 * The session cookie. HttpOnly (no JavaScript access), SameSite (CSRF
 * defence), Path=/ and host-only. When Secure, the `__Host-` prefix makes the
 * browser enforce Secure + Path=/ + no Domain, so subdomains cannot set or
 * overwrite it. The token is never sent in a response body.
 */
export function createAuthCookie({ cookieSecure, cookieSameSite }) {
  const name = cookieSecure ? '__Host-rtc_session' : 'rtc_session'
  const attributes = {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: '/',
  }

  return {
    name,
    /** Extracts the token from a raw Cookie header (HTTP or WS handshake). */
    read(cookieHeader) {
      if (!cookieHeader) return undefined
      return parse(cookieHeader)[name] || undefined
    },
    set(res, token, expiresAt) {
      res.cookie(name, token, { ...attributes, expires: expiresAt })
    },
    clear(res) {
      res.clearCookie(name, attributes)
    },
  }
}
