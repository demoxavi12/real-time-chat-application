const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/**
 * Parses durations such as "900ms", "30s", "15m", "1h", "7d" into
 * milliseconds. Returns null for anything else (including zero).
 */
export function parseDuration(value) {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(String(value).trim())
  if (!match) return null
  const ms = Number(match[1]) * UNIT_MS[match[2]]
  return Number.isSafeInteger(ms) && ms > 0 ? ms : null
}
