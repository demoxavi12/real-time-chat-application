import { AppError, ErrorCodes } from '../utils/AppError.js'

/**
 * Validates `data` against a zod schema. Shared by the HTTP `validate`
 * middleware and Socket.IO event handlers so both transports reject bad input
 * with the same VALIDATION_ERROR shape.
 */
export function parseWithSchema(schema, data, { location } = {}) {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  throw new AppError(
    400,
    ErrorCodes.VALIDATION_ERROR,
    'Invalid request',
    result.error.issues.map((issue) => ({
      path: [...(location ? [location] : []), ...issue.path].join('.'),
      message: issue.message,
    })),
  )
}
