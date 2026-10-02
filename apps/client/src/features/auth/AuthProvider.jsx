import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthContext } from './authContext.js'

const UNAUTHENTICATED_CODES = new Set([
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATION_INVALID',
])

/**
 * Owns authentication state only:
 *   status: 'loading' | 'authenticated' | 'unauthenticated' | 'error'
 * On mount it restores the session with GET /auth/me (the HttpOnly cookie is
 * sent automatically). A 401 means "not signed in"; anything else (network
 * failure, 5xx) is an error the user can retry.
 *
 * `notice: 'expired'` is set when a session that was signed in turns out to
 * be invalid on re-check (expired, revoked elsewhere), so the login page can
 * say why; an explicit sign-out sets no notice.
 */
export function AuthProvider({ authApi, children }) {
  const [state, setState] = useState({
    status: 'loading',
    user: null,
    notice: null,
  })
  const [attempt, setAttempt] = useState(0)
  const wasAuthenticated = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    authApi.me({ signal: controller.signal }).then(
      (user) => setState({ status: 'authenticated', user, notice: null }),
      (error) => {
        if (error?.name === 'AbortError') return
        const lostSession = wasAuthenticated.current
        wasAuthenticated.current = false
        setState(
          UNAUTHENTICATED_CODES.has(error?.code)
            ? {
                status: 'unauthenticated',
                user: null,
                notice: lostSession ? 'expired' : null,
              }
            : { status: 'error', user: null, notice: null, error },
        )
      },
    )
    return () => controller.abort()
  }, [authApi, attempt])

  const login = useCallback(
    async (credentials) => {
      const user = await authApi.login(credentials)
      setState({ status: 'authenticated', user, notice: null })
      return user
    },
    [authApi],
  )

  const register = useCallback(
    async (details) => {
      const user = await authApi.register(details)
      setState({ status: 'authenticated', user, notice: null })
      return user
    },
    [authApi],
  )

  const logout = useCallback(async () => {
    await authApi.logout()
    setState({ status: 'unauthenticated', user: null, notice: null })
  }, [authApi])

  /** Re-checks the session (e.g. after a 401 or a server-side disconnect). */
  const retry = useCallback(() => {
    setState((current) => {
      wasAuthenticated.current = current.status === 'authenticated'
      return { status: 'loading', user: null, notice: null }
    })
    setAttempt((n) => n + 1)
  }, [])

  /**
   * For data hooks: if `error` means the session is gone, re-check it (which
   * routes to the login page). Returns true when the error was handled.
   */
  const handleAuthError = useCallback(
    (error) => {
      if (!UNAUTHENTICATED_CODES.has(error?.code)) return false
      retry()
      return true
    },
    [retry],
  )

  const value = useMemo(
    () => ({ ...state, login, register, logout, retry, handleAuthError }),
    [state, login, register, logout, retry, handleAuthError],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
