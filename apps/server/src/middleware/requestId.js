import { randomUUID } from 'node:crypto'

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/

/**
 * Assigns `req.id` (reusing a well-formed inbound X-Request-Id, e.g. from a
 * proxy) and echoes it back so logs and client reports can be correlated.
 */
export function requestId() {
  return (req, res, next) => {
    const inbound = req.get('x-request-id')
    req.id = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID()
    res.setHeader('X-Request-Id', req.id)
    next()
  }
}
