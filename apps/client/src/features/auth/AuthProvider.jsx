import { useCallback, useEffect, useMemo, useState } from 'react'
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
 */
export function AuthProvider({ authApi, children }) {
  const [state, setState] = useState({ status: 'loading', user: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    authApi.me({ signal: controller.signal }).then(
      (user) => setState({ status: 'authenticated', user }),
      (error) => {
        if (error?.name === 'AbortError') return
        setState(
          UNAUTHENTICATED_CODES.has(error?.code)
            ? { status: 'unauthenticated', user: null }
            : { status: 'error', user: null, error },
        )
      },
    )
    return () => controller.abort()
  }, [authApi, attempt])

  const login = useCallback(
    async (credentials) => {
      const user = await authApi.login(credentials)
      setState({ status: 'authenticated', user })
      return user
    },
    [authApi],
  )

  const register = useCallback(
    async (details) => {
      const user = await authApi.register(details)
      setState({ status: 'authenticated', user })
      return user
    },
    [authApi],
  )

  const logout = useCallback(async () => {
    await authApi.logout()
    setState({ status: 'unauthenticated', user: null })
  }, [authApi])

  const retry = useCallback(() => {
    setState({ status: 'loading', user: null })
    setAttempt((n) => n + 1)
  }, [])

  const value = useMemo(
    () => ({ ...state, login, register, logout, retry }),
    [state, login, register, logout, retry],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
