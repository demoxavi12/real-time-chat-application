import { describe, expect, it } from 'vitest'
import { normalizeEmail } from '../../src/models/user.model.js'
import {
  loginSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  registerSchema,
} from '../../src/validators/auth.validators.js'
import { parseWithSchema } from '../../src/validators/parseWithSchema.js'

const valid = {
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  password: 'analytical-engine',
}

function issuesFor(schema, input) {
  const result = schema.safeParse(input)
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'))
}

describe('email normalization', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Ada.Lovelace@Example.TEST ')).toBe(
      'ada.lovelace@example.test',
    )
  })

  it('is applied by both schemas', () => {
    expect(
      registerSchema.parse({ ...valid, email: ' ADA@Example.Test ' }).email,
    ).toBe('ada@example.test')
    expect(
      loginSchema.parse({ email: 'ADA@EXAMPLE.TEST', password: 'x' }).email,
    ).toBe('ada@example.test')
  })
})

describe('registerSchema', () => {
  it('accepts valid input and trims the name', () => {
    expect(registerSchema.parse({ ...valid, name: '  Ada  ' })).toEqual({
      ...valid,
      name: 'Ada',
    })
  })

  it.each([
    ['missing name', { email: valid.email, password: valid.password }, 'name'],
    ['blank name', { ...valid, name: '   ' }, 'name'],
    ['name too long', { ...valid, name: 'x'.repeat(51) }, 'name'],
    ['control characters in name', { ...valid, name: 'Ada\u0000' }, 'name'],
    ['non-string name', { ...valid, name: { $gt: '' } }, 'name'],
    ['missing email', { name: valid.name, password: valid.password }, 'email'],
    ['malformed email', { ...valid, email: 'not-an-email' }, 'email'],
    ['email without domain', { ...valid, email: 'ada@' }, 'email'],
    [
      'email too long',
      { ...valid, email: `${'a'.repeat(250)}@x.test` },
      'email',
    ],
    ['operator object as email', { ...valid, email: { $ne: null } }, 'email'],
    ['missing password', { name: valid.name, email: valid.email }, 'password'],
    [
      'password too short',
      { ...valid, password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1) },
      'password',
    ],
    [
      'password too long',
      { ...valid, password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) },
      'password',
    ],
  ])('rejects %s', (_label, input, path) => {
    expect(issuesFor(registerSchema, input)).toContain(path)
  })

  it('accepts passwords exactly at the length bounds', () => {
    for (const length of [PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]) {
      expect(
        registerSchema.safeParse({ ...valid, password: 'p'.repeat(length) })
          .success,
      ).toBe(true)
    }
  })

  it.each(['_id', 'id', 'passwordHash', 'createdAt', 'updatedAt', 'userId'])(
    'rejects client-supplied server-owned field %s',
    (field) => {
      const result = registerSchema.safeParse({ ...valid, [field]: 'x' })
      expect(result.success).toBe(false)
      expect(result.error.issues[0].code).toBe('unrecognized_keys')
    },
  )

  it('reports issues through the shared VALIDATION_ERROR shape', () => {
    let error
    try {
      parseWithSchema(
        registerSchema,
        { ...valid, email: 'nope' },
        {
          location: 'body',
        },
      )
    } catch (err) {
      error = err
    }
    expect(error).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      details: [
        { path: 'body.email', message: 'Email must be a valid email address' },
      ],
    })
  })
})

describe('loginSchema', () => {
  it('does not apply the new-password length policy', () => {
    expect(
      loginSchema.safeParse({ email: valid.email, password: 'short' }).success,
    ).toBe(true)
  })

  it.each([
    ['missing password', { email: valid.email }],
    ['empty password', { email: valid.email, password: '' }],
    ['oversized password', { email: valid.email, password: 'x'.repeat(129) }],
    ['malformed email', { email: 'nope', password: 'whatever' }],
    ['extra fields', { email: valid.email, password: 'x', userId: 'u1' }],
  ])('rejects %s', (_label, input) => {
    expect(loginSchema.safeParse(input).success).toBe(false)
  })
})
