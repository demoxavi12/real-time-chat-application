import { render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { vi } from 'vitest'
import App from '../src/App.jsx'
import { ApiError } from '../src/services/api/httpClient.js'

export const alice = Object.freeze({
  id: '65f000000000000000000001',
  name: 'Alice Example',
  email: 'alice@example.test',
  createdAt: '2026-01-01T00:00:00.000Z',
})

export const apiError = (code, status = 400, details = []) =>
  new ApiError({ status, code, message: code, details })

export const notSignedIn = () => apiError('AUTHENTICATION_REQUIRED', 401)

export function healthySystemApi() {
  return {
    getHealth: vi.fn(async () => ({ status: 'ok' })),
    getReadiness: vi.fn(async () => ({
      status: 'ready',
      checks: { database: 'up' },
    })),
  }
}

/** Fake auth API; by default nobody is signed in and every call succeeds. */
export function fakeAuthApi(overrides = {}) {
  return {
    me: vi.fn(async () => {
      throw notSignedIn()
    }),
    login: vi.fn(async () => alice),
    register: vi.fn(async ({ name, email }) => ({ ...alice, name, email })),
    logout: vi.fn(async () => ({ loggedOut: true })),
    ...overrides,
  }
}

/** Exposes the current router location for assertions. */
function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  )
}

export function renderApp({
  route = '/',
  state,
  authApi = fakeAuthApi(),
  systemApi = healthySystemApi(),
} = {}) {
  const utils = render(
    <MemoryRouter initialEntries={[state ? { pathname: route, state } : route]}>
      <App authApi={authApi} systemApi={systemApi} />
      <LocationProbe />
    </MemoryRouter>,
  )
  return { ...utils, authApi, systemApi }
}
