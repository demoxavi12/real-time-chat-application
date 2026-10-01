// Mirrors the server rules (apps/server/src/validators/auth.validators.js) for
// fast feedback. The server validates independently and is authoritative.
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128
export const NAME_MAX_LENGTH = 50
const EMAIL_MAX_LENGTH = 254
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateEmail(email) {
  const value = email.trim()
  if (!value) return 'Email is required'
  if (value.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(value)) {
    return 'Enter a valid email address'
  }
  return undefined
}

function validateName(name) {
  const value = name.trim()
  if (!value) return 'Name is required'
  if (value.length > NAME_MAX_LENGTH) {
    return `Name must be at most ${NAME_MAX_LENGTH} characters`
  }
  return undefined
}

function validateNewPassword(password) {
  if (!password) return 'Password is required'
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`
  }
  return undefined
}

function compact(errors) {
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => v))
}

export function validateLogin({ email, password }) {
  return compact({
    email: validateEmail(email),
    password: password ? undefined : 'Password is required',
  })
}

export function validateRegistration({ name, email, password }) {
  return compact({
    name: validateName(name),
    email: validateEmail(email),
    password: validateNewPassword(password),
  })
}

const MESSAGES = {
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  EMAIL_ALREADY_EXISTS: 'An account with this email already exists.',
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
  NETWORK_ERROR:
    'Unable to reach the server. Check your connection and try again.',
}

/**
 * Maps an ApiError to `{ form, fields }` for display. Server validation
 * details (path `body.email`) become field errors.
 */
export function describeAuthError(error) {
  if (error?.code === 'VALIDATION_ERROR' && error.details?.length) {
    const fields = {}
    for (const detail of error.details) {
      const field = String(detail.path ?? '').replace(/^body\./, '')
      if (field && !fields[field]) fields[field] = detail.message
    }
    return { form: 'Please correct the highlighted fields.', fields }
  }
  if (error?.code === 'EMAIL_ALREADY_EXISTS') {
    return {
      form: MESSAGES.EMAIL_ALREADY_EXISTS,
      fields: { email: MESSAGES.EMAIL_ALREADY_EXISTS },
    }
  }
  return {
    form: MESSAGES[error?.code] ?? 'Something went wrong. Please try again.',
    fields: {},
  }
}

/** Only same-app paths are valid post-login destinations (no open redirect). */
export function safeRedirectPath(candidate) {
  if (
    typeof candidate !== 'string' ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.startsWith('/\\')
  ) {
    return '/'
  }
  const path = candidate.split(/[?#]/)[0]
  return path === '/login' || path === '/register' ? '/' : candidate
}
