import { AppError, ErrorCodes } from '../utils/AppError.js'

export function notFound(req, _res, next) {
  next(new AppError(404, ErrorCodes.NOT_FOUND, 'Route not found'))
}
