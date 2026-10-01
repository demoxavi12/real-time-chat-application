import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)

/** Access the auth state and actions provided by <AuthProvider>. */
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
