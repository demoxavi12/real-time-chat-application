/**
 * Fixed-window counters for Socket.IO abuse protection. `consume(key)`
 * returns false once `max` events were counted for `key` in the current
 * window. Expired entries are pruned lazily so the map cannot grow without
 * bound.
 */
export function createWindowCounter({ windowMs, max, now = () => Date.now() }) {
  const counters = new Map()

  function prune(at) {
    for (const [key, entry] of counters) {
      if (entry.resetAt <= at) counters.delete(key)
    }
  }

  return {
    consume(key) {
      const at = now()
      let entry = counters.get(key)
      if (!entry || entry.resetAt <= at) {
        if (counters.size > 10_000) prune(at)
        entry = { count: 0, resetAt: at + windowMs }
        counters.set(key, entry)
      }
      entry.count += 1
      return entry.count <= max
    },
    get size() {
      return counters.size
    },
  }
}

/**
 * Per-socket limits (one instance per connection, discarded with it):
 * `event` counts every incoming event, `message` counts message:send,
 * `invalid` counts rejected (VALIDATION_ERROR) payloads.
 */
export function createSocketLimiter(limits, now) {
  const window = (max) =>
    createWindowCounter({ windowMs: limits.windowMs, max, now })
  const counters = {
    event: window(limits.eventLimit),
    message: window(limits.messageLimit),
    invalid: window(limits.invalidEventLimit),
  }
  return {
    consume: (category) => counters[category].consume(category),
  }
}
