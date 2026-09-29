/**
 * Logs one line per completed request. Deliberately records only the path
 * (no query string, headers, cookies or body) to avoid leaking sensitive data.
 */
export function requestLogger(logger) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint()
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
      logger.info('request completed', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      })
    })
    next()
  }
}
