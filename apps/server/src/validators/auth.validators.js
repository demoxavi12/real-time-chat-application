import { z } from 'zod'
import {
  EMAIL_MAX_LENGTH,
  normalizeEmail,
  USER_NAME_MAX_LENGTH,
} from '../models/user.model.js'

// NIST SP 800-63B: at least 8 characters, no composition rules. The maximum
// bounds hashing cost (DoS) while still allowing long passphrases.
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export const emailSchema = z
  .string({ error: 'Email is required' })
  .max(EMAIL_MAX_LENGTH, `Email must be at most ${EMAIL_MAX_LENGTH} characters`)
  .transform(normalizeEmail)
  .pipe(z.email({ error: 'Email must be a valid email address' }))

export const passwordSchema = z
  .string({ error: 'Password is required' })
  .min(
    PASSWORD_MIN_LENGTH,
    `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
  )

export const nameSchema = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(
    USER_NAME_MAX_LENGTH,
    `Name must be at most ${USER_NAME_MAX_LENGTH} characters`,
  )
  .refine(
    (name) => !CONTROL_CHARACTERS.test(name),
    'Name contains invalid characters',
  )

// `.strict()` rejects unknown keys, so clients cannot smuggle server-owned
// fields such as _id, passwordHash, createdAt or a user id.
export const registerSchema = z
  .object({ name: nameSchema, email: emailSchema, password: passwordSchema })
  .strict()

export const loginSchema = z
  .object({
    email: emailSchema,
    // Only bounded here; the length policy applies to new passwords.
    password: z
      .string({ error: 'Password is required' })
      .min(1, 'Password is required')
      .max(PASSWORD_MAX_LENGTH, 'Email or password is incorrect'),
  })
  .strict()
