import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../features/auth/authContext.js'
import { SystemStatus } from '../features/system/SystemStatus.jsx'

/** Protected application shell. Chat UI arrives in a later phase. */
export function HomePage({ systemApi }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState(null)

  async function handleLogout() {
    setSigningOut(true)
    setError(null)
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch {
      setError('Sign out failed. Please try again.')
      setSigningOut(false)
    }
  }

  return (
    <>
      <section className="card session-bar" aria-label="Account">
        <p>
          Signed in as <strong data-testid="current-user">{user.name}</strong>{' '}
          <span className="muted">({user.email})</span>
        </p>
        <button type="button" onClick={handleLogout} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
      <SystemStatus systemApi={systemApi} />
    </>
  )
}
