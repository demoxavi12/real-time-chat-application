export class TimeoutError extends Error {
  constructor(ms) {
    super(`Operation timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

/** Rejects with TimeoutError if `promise` does not settle within `ms`. */
export function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
