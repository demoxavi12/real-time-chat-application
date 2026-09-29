import { describe, expect, it, vi } from 'vitest'
import { ApiError, createHttpClient } from '../src/services/api/httpClient.js'
import { createSystemApi } from '../src/services/api/systemApi.js'

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

describe('httpClient', () => {
  it('unwraps the success envelope and sends credentials', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { success: true, data: { status: 'ok' } }),
    )
    const http = createHttpClient({ baseUrl: '/api/', fetchImpl })

    await expect(http.get('/health')).resolves.toEqual({ status: 'ok' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/health')
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    expect(init.body).toBeUndefined()
  })

  it('serializes JSON request bodies', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { success: true, data: { id: '1' } }),
    )
    const http = createHttpClient({
      baseUrl: 'https://api.example.com/api',
      fetchImpl,
    })

    await http.request('/things', { method: 'POST', body: { a: 1 } })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.example.com/api/things')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"a":1}')
  })

  it('maps error envelopes to ApiError', async () => {
    const http = createHttpClient({
      baseUrl: '/api',
      fetchImpl: async () =>
        jsonResponse(400, {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            details: [{ path: 'body.email', message: 'Required' }],
          },
        }),
    })

    const error = await http.get('/x').catch((err) => err)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      details: [{ path: 'body.email', message: 'Required' }],
    })
  })

  it('handles non-JSON error responses', async () => {
    const http = createHttpClient({
      baseUrl: '/api',
      fetchImpl: async () => new Response('Bad gateway', { status: 502 }),
    })
    await expect(http.get('/x')).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_ERROR',
      message: 'Request failed with status 502',
    })
  })

  it('treats a 2xx without a success envelope as an error', async () => {
    const http = createHttpClient({
      baseUrl: '/api',
      fetchImpl: async () => jsonResponse(200, { unexpected: true }),
    })
    await expect(http.get('/x')).rejects.toMatchObject({ code: 'HTTP_ERROR' })
  })

  it('maps network failures to NETWORK_ERROR', async () => {
    const http = createHttpClient({
      baseUrl: '/api',
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await expect(http.get('/x')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Unable to reach the server',
    })
  })

  it('propagates aborts unchanged', async () => {
    const abort = new DOMException('Aborted', 'AbortError')
    const http = createHttpClient({
      baseUrl: '/api',
      fetchImpl: async () => {
        throw abort
      },
    })
    await expect(http.get('/x')).rejects.toBe(abort)
  })
})

describe('systemApi', () => {
  it('calls the health and readiness endpoints', async () => {
    const http = { get: vi.fn(async (path) => path) }
    const api = createSystemApi(http)
    const signal = new AbortController().signal

    await expect(api.getHealth({ signal })).resolves.toBe('/health')
    await expect(api.getReadiness()).resolves.toBe('/ready')
    expect(http.get).toHaveBeenCalledWith('/health', { signal })
  })
})
