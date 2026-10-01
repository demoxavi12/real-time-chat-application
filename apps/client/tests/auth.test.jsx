import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../src/features/auth/authContext.js'
import {
  alice,
  apiError,
  fakeAuthApi,
  notSignedIn,
  renderApp,
} from './helpers.jsx'

const location = () => screen.getByTestId('location').textContent
const signedIn = () => fakeAuthApi({ me: vi.fn(async () => alice) })

function fill(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => vi.restoreAllMocks())

describe('session restore and route protection', () => {
  it('shows a session check while /auth/me is pending', async () => {
    const pending = deferred()
    renderApp({ authApi: fakeAuthApi({ me: () => pending.promise }) })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking your session',
    )
    pending.resolve(alice)
    expect(await screen.findByTestId('current-user')).toHaveTextContent(
      alice.name,
    )
  })

  it('redirects unauthenticated users from the app to /login', async () => {
    renderApp({ route: '/' })
    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(location()).toBe('/login')
    expect(screen.queryByTestId('current-user')).not.toBeInTheDocument()
  })

  it('restores an existing session and shows the protected shell', async () => {
    const { authApi } = renderApp({ route: '/', authApi: signedIn() })
    expect(await screen.findByTestId('current-user')).toHaveTextContent(
      alice.name,
    )
    expect(screen.getByText(`(${alice.email})`)).toBeInTheDocument()
    expect(authApi.me).toHaveBeenCalledOnce()
    expect(location()).toBe('/')
  })

  it.each(['/login', '/register'])(
    'sends signed-in users away from %s',
    async (route) => {
      renderApp({ route, authApi: signedIn() })
      expect(await screen.findByTestId('current-user')).toBeInTheDocument()
      expect(location()).toBe('/')
    },
  )

  it('treats an invalid/expired session as signed out', async () => {
    renderApp({
      authApi: fakeAuthApi({
        me: vi.fn(async () => {
          throw apiError('AUTHENTICATION_INVALID', 401)
        }),
      }),
    })
    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument()
  })

  it('shows a retryable error when the session cannot be verified', async () => {
    const me = vi
      .fn()
      .mockRejectedValueOnce(apiError('NETWORK_ERROR', 0))
      .mockResolvedValue(alice)
    renderApp({ authApi: fakeAuthApi({ me }) })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to verify your session')
    expect(location()).toBe('/')

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('current-user')).toBeInTheDocument()
    expect(me).toHaveBeenCalledTimes(2)
  })

  it('keeps the public status page reachable without signing in', async () => {
    renderApp({ route: '/status' })
    expect(await screen.findByLabelText('Backend status')).toBeInTheDocument()
    expect(location()).toBe('/status')
  })

  it('sends unknown routes to the app (and on to login when signed out)', async () => {
    renderApp({ route: '/does-not-exist' })
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(location()).toBe('/login')
  })
})

describe('login page', () => {
  async function openLogin(authApi = fakeAuthApi(), state) {
    const utils = renderApp({ route: '/login', authApi, state })
    await screen.findByRole('heading', { name: 'Sign in' })
    return utils
  }

  it('has labelled email and password fields with correct autocomplete', async () => {
    await openLogin()
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'autocomplete',
      'email',
    )
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
  })

  it('validates input before calling the API', async () => {
    const { authApi } = await openLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Email is required')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    )

    fill('Email', 'not-an-email')
    fill('Password', 'secret-password')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(
      await screen.findByText('Enter a valid email address'),
    ).toBeInTheDocument()
    expect(authApi.login).not.toHaveBeenCalled()
  })

  it('shows a loading state and prevents double submission', async () => {
    const pending = deferred()
    const authApi = fakeAuthApi({ login: vi.fn(() => pending.promise) })
    await openLogin(authApi)
    fill('Email', alice.email)
    fill('Password', 'secret-password')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const button = await screen.findByRole('button', { name: 'Signing in…' })
    expect(button).toBeDisabled()
    fireEvent.submit(button.closest('form'))
    expect(authApi.login).toHaveBeenCalledOnce()
    pending.resolve(alice)
    await screen.findByTestId('current-user')
  })

  it('signs in and opens the protected shell', async () => {
    const { authApi } = await openLogin()
    fill('Email', `  ${alice.email} `)
    fill('Password', 'secret-password')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByTestId('current-user')).toHaveTextContent(
      alice.name,
    )
    expect(authApi.login).toHaveBeenCalledWith({
      email: alice.email,
      password: 'secret-password',
    })
    expect(location()).toBe('/')
  })

  it('returns to the originally requested page after login', async () => {
    await openLogin(fakeAuthApi(), { from: '/?tab=status' })
    fill('Email', alice.email)
    fill('Password', 'secret-password')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByTestId('current-user')
    expect(location()).toBe('/?tab=status')
  })

  it.each([
    '//evil.example.com',
    'https://evil.example.com',
    '/\\evil.example.com',
  ])('never redirects off-site after login (from=%s)', async (from) => {
    await openLogin(fakeAuthApi(), { from })
    fill('Email', alice.email)
    fill('Password', 'secret-password')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByTestId('current-user')
    expect(location()).toBe('/')
  })

  it.each([
    ['INVALID_CREDENTIALS', 401, 'Email or password is incorrect.'],
    [
      'RATE_LIMITED',
      429,
      'Too many attempts. Please wait a few minutes and try again.',
    ],
    [
      'NETWORK_ERROR',
      0,
      'Unable to reach the server. Check your connection and try again.',
    ],
    ['INTERNAL_ERROR', 500, 'Something went wrong. Please try again.'],
  ])(
    'shows a useful message for %s and stays signed out',
    async (code, status, message) => {
      const authApi = fakeAuthApi({
        login: vi.fn(async () => {
          throw apiError(code, status)
        }),
      })
      await openLogin(authApi)
      fill('Email', alice.email)
      fill('Password', 'wrong-password')
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
      expect(screen.queryByTestId('current-user')).not.toBeInTheDocument()
      expect(location()).toBe('/login')
    },
  )

  it('links to registration', async () => {
    await openLogin()
    fireEvent.click(screen.getByRole('link', { name: 'Create one' }))
    expect(
      await screen.findByRole('heading', { name: 'Create an account' }),
    ).toBeInTheDocument()
  })

  it('never writes the password to the console', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    )
    const authApi = fakeAuthApi({
      login: vi.fn(async () => {
        throw apiError('INVALID_CREDENTIALS', 401)
      }),
    })
    await openLogin(authApi)
    fill('Email', alice.email)
    fill('Password', 'p4ssw0rd-never-logged')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('alert')
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(
        'p4ssw0rd-never-logged',
      )
    }
  })
})

describe('registration page', () => {
  async function openRegister(authApi = fakeAuthApi()) {
    const utils = renderApp({ route: '/register', authApi })
    await screen.findByRole('heading', { name: 'Create an account' })
    return utils
  }

  it('validates every field before calling the API', async () => {
    const { authApi } = await openRegister()
    fill('Name', '   ')
    fill('Email', 'bad')
    fill('Password', 'short')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
    expect(
      screen.getByText('Password must be at least 8 characters'),
    ).toBeInTheDocument()
    expect(authApi.register).not.toHaveBeenCalled()
  })

  it('describes the password rule and links the hint to the field', async () => {
    await openRegister()
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('autocomplete', 'new-password')
    expect(password).toHaveAccessibleDescription('8–128 characters.')
  })

  it('creates the account and opens the protected shell', async () => {
    const { authApi } = await openRegister()
    fill('Name', '  Bob Example ')
    fill('Email', 'bob@example.test')
    fill('Password', 'long-enough-password')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(
      await screen.findByRole('button', { name: 'Sign out' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('current-user')).toHaveTextContent('Bob Example')
    expect(authApi.register).toHaveBeenCalledWith({
      name: 'Bob Example',
      email: 'bob@example.test',
      password: 'long-enough-password',
    })
    expect(location()).toBe('/')
  })

  it('shows the loading state while submitting', async () => {
    const pending = deferred()
    await openRegister(fakeAuthApi({ register: vi.fn(() => pending.promise) }))
    fill('Name', 'Bob')
    fill('Email', 'bob@example.test')
    fill('Password', 'long-enough-password')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(
      await screen.findByRole('button', { name: 'Creating account…' }),
    ).toBeDisabled()
    pending.reject(apiError('NETWORK_ERROR', 0))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to reach the server',
    )
  })

  it('flags an already registered email on the email field', async () => {
    await openRegister(
      fakeAuthApi({
        register: vi.fn(async () => {
          throw apiError('EMAIL_ALREADY_EXISTS', 409)
        }),
      }),
    )
    fill('Name', 'Bob')
    fill('Email', 'taken@example.test')
    fill('Password', 'long-enough-password')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email already exists.',
    )
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(location()).toBe('/register')
  })

  it('maps server validation details onto fields', async () => {
    await openRegister(
      fakeAuthApi({
        register: vi.fn(async () => {
          throw apiError('VALIDATION_ERROR', 400, [
            { path: 'body.name', message: 'Name contains invalid characters' },
          ])
        }),
      }),
    )
    fill('Name', 'Bob')
    fill('Email', 'bob@example.test')
    fill('Password', 'long-enough-password')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(
      await screen.findByText('Name contains invalid characters'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })
})

describe('logout', () => {
  it('signs out, returns to login and blocks the protected shell', async () => {
    const me = vi.fn(async () => alice)
    const authApi = fakeAuthApi({ me })
    renderApp({ route: '/', authApi })
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(authApi.logout).toHaveBeenCalledOnce()
    expect(location()).toBe('/login')
    expect(screen.queryByTestId('current-user')).not.toBeInTheDocument()
  })

  it('keeps the user signed in and reports an error if logout fails', async () => {
    const authApi = fakeAuthApi({
      me: vi.fn(async () => alice),
      logout: vi.fn(async () => {
        throw apiError('NETWORK_ERROR', 0)
      }),
    })
    renderApp({ route: '/', authApi })
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign out failed',
    )
    expect(screen.getByTestId('current-user')).toBeInTheDocument()
    expect(location()).toBe('/')
  })
})

describe('useAuth', () => {
  it('throws a clear error outside <AuthProvider>', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Probe() {
      useAuth()
      return null
    }
    expect(() => render(<Probe />)).toThrow(
      'useAuth must be used inside <AuthProvider>',
    )
  })

  it('aborts the session check when unmounted', async () => {
    let signal
    const authApi = fakeAuthApi({
      me: vi.fn((options) => {
        signal = options.signal
        return new Promise(() => {})
      }),
    })
    const { unmount } = renderApp({ authApi })
    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    expect(signal.aborted).toBe(true)
  })

  it('does not treat the unauthenticated 401 as an error', async () => {
    renderApp({
      authApi: fakeAuthApi({
        me: vi.fn(async () => {
          throw notSignedIn()
        }),
      }),
    })
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(
      screen.queryByText('Unable to verify your session'),
    ).not.toBeInTheDocument()
  })
})
