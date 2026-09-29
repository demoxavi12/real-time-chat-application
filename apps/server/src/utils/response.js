/** Standard success envelope (docs/05-api-spec.md). */
export function sendSuccess(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data })
}

/** Standard error envelope (docs/05-api-spec.md). */
export function sendError(res, statusCode, error) {
  return res.status(statusCode).json({ success: false, error })
}
