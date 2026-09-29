import { withTimeout } from '../utils/withTimeout.js'

/**
 * Runs named dependency checks (async functions that reject when unhealthy)
 * concurrently. The service is ready only if every check passes in time.
 */
export function createReadinessService(checks, { timeoutMs = 3000 } = {}) {
  return {
    async check() {
      const names = Object.keys(checks)
      const results = await Promise.allSettled(
        names.map((name) =>
          withTimeout(Promise.resolve().then(checks[name]), timeoutMs),
        ),
      )
      const statuses = Object.fromEntries(
        names.map((name, i) => [
          name,
          results[i].status === 'fulfilled' ? 'up' : 'down',
        ]),
      )
      return {
        ready: Object.values(statuses).every((status) => status === 'up'),
        checks: statuses,
      }
    },
  }
}
