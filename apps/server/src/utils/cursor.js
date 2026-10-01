import { AppError, ErrorCodes } from './AppError.js'

/**
 * Opaque pagination cursors: base64url(JSON). A cursor only describes a
 * position (sort key + id) inside a result set the caller is already
 * authorized to read, so it is not signed; it is validated strictly on the
 * way back in, and a cursor of the wrong kind (or, for messages, for another
 * conversation) is rejected with INVALID_CURSOR.
 */
export function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

const invalidCursor = () =>
  new AppError(400, ErrorCodes.INVALID_CURSOR, 'Invalid pagination cursor')

/** Decodes `cursor` and validates it with a zod `schema`; throws 400. */
export function decodeCursor(cursor, schema) {
  let payload
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw invalidCursor()
  }
  const result = schema.safeParse(payload)
  if (!result.success) throw invalidCursor()
  return result.data
}
