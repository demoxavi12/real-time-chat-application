import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './authContext.js'
import { safeRedirectPath } from './validation.js'

function SessionCheck() {
  return (
    <p role="status" className="card">
      Checking your session…
    </p>
  )
}

function SessionError({ onRetry }) {
  return (
    <section className="card" role="alert">
      <h2>Unable to verify your session</h2>
      <p>The server could not be reached. Please try again.</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </section>
  )
}

/** Renders child routes only for authenticated users. */
export function RequireAuth() {
  const { status, retry } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <SessionCheck />
  if (status === 'error') return <SessionError onRetry={retry} />
  if (status === 'unauthenticated') {
    const from = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to="/login" replace state={{ from }} />
  }
  return <Outlet />
}

/**
 * Login/register pages. Once the user is authenticated (already signed in,
 * or just signed in on this page) this guard is the single place that sends
 * them on: back to the page that required auth, if it is a safe in-app path.
 */
export function GuestOnly() {
  const { status, retry } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <SessionCheck />
  if (status === 'error') return <SessionError onRetry={retry} />
  if (status === 'authenticated') {
    return <Navigate to={safeRedirectPath(location.state?.from)} replace />
  }
  return <Outlet />
}
