/**
 * Error raised for any failed API call. `code` mirrors the server's stable
 * error codes (docs/05-api-spec.md); NETWORK_ERROR means no response arrived.
 */
export class ApiError extends Error {
  constructor({ status, code, message, details = [] }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

async function readJson(response) {
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) return null
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Thin fetch wrapper that understands the `{ success, data | error }`
 * envelope. All REST calls go through this boundary so auth headers,
 * credentials and error mapping live in one place.
 */
export function createHttpClient({ baseUrl, fetchImpl = fetch }) {
  const root = baseUrl.replace(/\/+$/, '')

  async function request(path, { method = 'GET', body, signal } = {}) {
    let response
    try {
      response = await fetchImpl(`${root}${path}`, {
        method,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      throw new ApiError({
        status: 0,
        code: 'NETWORK_ERROR',
        message: 'Unable to reach the server',
      })
    }

    const payload = await readJson(response)
    if (response.ok && payload?.success === true) return payload.data

    throw new ApiError({
      status: response.status,
      code: payload?.error?.code ?? 'HTTP_ERROR',
      message:
        payload?.error?.message ??
        `Request failed with status ${response.status}`,
      details: payload?.error?.details ?? [],
    })
  }

  return {
    request,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
  }
}
