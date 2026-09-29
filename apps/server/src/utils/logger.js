const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }

// Keys whose values must never reach log output.
const SENSITIVE_KEY =
  /pass(word)?|secret|token|jwt|authorization|cookie|api[-_]?key|credential|mongodb_?uri|connection_?string/i
const REDACTED = '[REDACTED]'
const MAX_DEPTH = 6

function serializeError(error) {
  return {
    name: error.name,
    message: error.message,
    ...(error.code !== undefined && { code: error.code }),
    stack: error.stack,
  }
}

export function redact(value, depth = 0) {
  if (value instanceof Error) return serializeError(value)
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return '[Truncated]'
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redact(entry, depth + 1),
    ]),
  )
}

/**
 * Minimal structured (JSON lines) logger. All fields pass through `redact`
 * so secrets are dropped even if a caller logs them by mistake.
 */
export function createLogger({
  level = 'info',
  stream = process.stdout,
  bindings = {},
} = {}) {
  if (!(level in LEVELS)) throw new Error(`Unknown log level "${level}"`)
  const threshold = LEVELS[level]

  function write(entryLevel, message, fields = {}) {
    if (LEVELS[entryLevel] > threshold) return
    const entry = {
      time: new Date().toISOString(),
      level: entryLevel,
      msg: message,
      ...redact({ ...bindings, ...fields }),
    }
    stream.write(`${JSON.stringify(entry)}\n`)
  }

  return {
    level,
    error: (message, fields) => write('error', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    info: (message, fields) => write('info', message, fields),
    debug: (message, fields) => write('debug', message, fields),
    child: (extra) =>
      createLogger({ level, stream, bindings: { ...bindings, ...extra } }),
  }
}
