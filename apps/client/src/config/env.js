/**
 * Client runtime configuration, resolved from Vite `VITE_*` variables.
 * NOTE: every VITE_* value is embedded in the public bundle — never put
 * secrets here.
 *
 * Both URLs are optional. When unset the client talks to its own origin:
 * `/api` for REST and the page origin for Socket.IO. In development the Vite
 * server proxies both to the backend; in production a reverse proxy can do the
 * same, so no host names are hard-coded into the build.
 */
export class ClientConfigError extends Error {
  constructor(name, value) {
    super(
      `${name} must be an absolute http(s) URL or a path starting with "/" (got "${value}")`,
    )
    this.name = 'ClientConfigError'
  }
}

function normalizeUrl(name, raw) {
  const value = raw?.trim()
  if (!value) return undefined
  if (value.startsWith('/') && !value.startsWith('//')) {
    return value.replace(/\/+$/, '') || '/'
  }
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new ClientConfigError(name, value)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ClientConfigError(name, value)
  }
  return value.replace(/\/+$/, '')
}

export function resolveClientConfig(env) {
  return Object.freeze({
    apiUrl: normalizeUrl('VITE_API_URL', env.VITE_API_URL) ?? '/api',
    // undefined => same origin (socket.io-client default)
    socketUrl: normalizeUrl('VITE_SOCKET_URL', env.VITE_SOCKET_URL),
  })
}
