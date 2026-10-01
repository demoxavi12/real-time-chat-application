import { z } from 'zod'

/** 24-hex MongoDB ObjectId, normalized to lower case. Rejects anything else
 * (including operator objects) before it can reach a query. */
export const objectIdSchema = z
  .string({ error: 'Must be a valid id' })
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id')
  .transform((id) => id.toLowerCase())

/** Page size from a query string: integer in [1, max], default `fallback`. */
export function limitSchema({ fallback, max }) {
  return z.coerce
    .number({ error: 'limit must be a number' })
    .int('limit must be an integer')
    .min(1, 'limit must be at least 1')
    .max(max, `limit must be at most ${max}`)
    .default(fallback)
}

/** Opaque cursor string (decoded and validated by the service). */
export const cursorSchema = z
  .string({ error: 'Invalid pagination cursor' })
  .min(1, 'Invalid pagination cursor')
  .max(256, 'Invalid pagination cursor')
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid pagination cursor')
