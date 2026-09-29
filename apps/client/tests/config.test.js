import { describe, expect, it } from 'vitest'
import { ClientConfigError, resolveClientConfig } from '../src/config/env.js'

describe('resolveClientConfig', () => {
  it('defaults to same-origin endpoints', () => {
    expect(resolveClientConfig({})).toEqual({
      apiUrl: '/api',
      socketUrl: undefined,
    })
  })

  it('treats blank values as unset', () => {
    expect(
      resolveClientConfig({ VITE_API_URL: '  ', VITE_SOCKET_URL: '' }),
    ).toEqual({ apiUrl: '/api', socketUrl: undefined })
  })

  it('accepts absolute URLs and strips trailing slashes', () => {
    expect(
      resolveClientConfig({
        VITE_API_URL: 'https://chat.example.com/api/',
        VITE_SOCKET_URL: 'https://chat.example.com/',
      }),
    ).toEqual({
      apiUrl: 'https://chat.example.com/api',
      socketUrl: 'https://chat.example.com',
    })
  })

  it('accepts root-relative paths', () => {
    expect(resolveClientConfig({ VITE_API_URL: '/backend/api/' }).apiUrl).toBe(
      '/backend/api',
    )
  })

  it.each([
    'localhost:5000/api',
    'ftp://example.com',
    '//evil.example.com/api',
    'javascript:alert(1)',
  ])('rejects invalid VITE_API_URL %s', (value) => {
    expect(() => resolveClientConfig({ VITE_API_URL: value })).toThrow(
      ClientConfigError,
    )
  })

  it('names the offending variable', () => {
    expect(() => resolveClientConfig({ VITE_SOCKET_URL: 'nope' })).toThrow(
      /^VITE_SOCKET_URL must be/,
    )
  })

  it('returns a frozen object', () => {
    expect(Object.isFrozen(resolveClientConfig({}))).toBe(true)
  })
})
