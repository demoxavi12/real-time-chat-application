import { describe, expect, it, vi } from 'vitest'
import {
  describeAuthError,
  safeRedirectPath,
  validateLogin,
  validateRegistration,
} from '../src/features/auth/validation.js'
import { createAuthApi } from '../src/services/api/authApi.js'
import { createHttpClient } from '../src/services/api/httpClient.js'

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const user = { id: 'u1', name: 'Alice', email: 'a@example.test' }

describe('authApi', () => {
  function setup(response) {
    const fetchImpl = vi.fn(async () => response)
    const api = createAuthApi(createHttpClient({ baseUrl: '/api', fetchImpl }))
    return { api, fetchImpl }
  }

  it('login POSTs only email and password with credentials and returns the user', async () => {
    const { api, fetchImpl } = setup(
      jsonResponse(200, { success: true, data: { user } }),
    )
    await expect(
      api.login({ email: 'a@example.test', password: 'pw', userId: 'forged' }),
    ).resolves.toEqual(user)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/auth/login')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse(init.body)).toEqual({
      email: 'a@example.test',
      password: 'pw',
    })
  })

  it('register sends name, email and password only', async () => {
    const { api, fetchImpl } = setup(
      jsonResponse(201, { success: true, data: { user } }),
    )
    await api.register({
      name: 'Alice',
      email: 'a@example.test',
      password: 'pw',
      _id: 'x',
    })
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/auth/register')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      name: 'Alice',
      email: 'a@example.test',
      password: 'pw',
    })
  })

  it('me GETs the current user and forwards the abort signal', async () => {
    const { api, fetchImpl } = setup(
      jsonResponse(200, { success: true, data: { user } }),
    )
    const signal = new AbortController().signal
    await expect(api.me({ signal })).resolves.toEqual(user)
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/auth/me')
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      signal,
      credentials: 'include',
    })
  })

  it('logout POSTs without a body', async () => {
    const { api, fetchImpl } = setup(
      jsonResponse(200, { success: true, data: { loggedOut: true } }),
    )
    await api.logout()
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/auth/logout')
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: undefined,
    })
  })

  it('surfaces auth error codes as ApiError', async () => {
    const { api } = setup(
      jsonResponse(401, {
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email or password is incorrect',
        },
      }),
    )
    await expect(
      api.login({ email: 'a@example.test', password: 'x' }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    })
  })
})

describe('client-side auth validation', () => {
  it('accepts valid login input', () => {
    expect(validateLogin({ email: 'a@example.test', password: 'x' })).toEqual(
      {},
    )
  })

  it('requires both login fields', () => {
    expect(validateLogin({ email: ' ', password: '' })).toEqual({
      email: 'Email is required',
      password: 'Password is required',
    })
  })

  it('applies the registration rules', () => {
    expect(
      validateRegistration({
        name: 'x'.repeat(51),
        email: 'a@b',
        password: 'p'.repeat(129),
      }),
    ).toEqual({
      name: 'Name must be at most 50 characters',
      email: 'Enter a valid email address',
      password: 'Password must be at most 128 characters',
    })
    expect(
      validateRegistration({
        name: 'Ann',
        email: 'ann@example.test',
        password: '12345678',
      }),
    ).toEqual({})
  })

  it('maps error codes to messages', () => {
    expect(describeAuthError({ code: 'INVALID_CREDENTIALS' }).form).toBe(
      'Email or password is incorrect.',
    )
    expect(describeAuthError(new Error('boom')).form).toBe(
      'Something went wrong. Please try again.',
    )
  })

  it.each([
    ['/', '/'],
    ['/status', '/status'],
    ['/?a=1#x', '/?a=1#x'],
    ['/login', '/'],
    ['/register?x=1', '/'],
    ['//evil.example.com', '/'],
    ['/\\evil.example.com', '/'],
    ['https://evil.example.com', '/'],
    ['javascript:alert(1)', '/'],
    [undefined, '/'],
    [{}, '/'],
  ])('safeRedirectPath(%o) -> %s', (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected)
  })
})
