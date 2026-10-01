import { describe, expect, it } from 'vitest'
import {
  ARGON2_OPTIONS,
  hashPassword,
  verifyAgainstDummyHash,
  verifyPassword,
} from '../../src/services/password.service.js'

const password = 'correct horse battery staple'

describe('password service', () => {
  it('produces an Argon2id PHC hash with the configured parameters', async () => {
    const hash = await hashPassword(password)
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/)
    expect(hash).not.toContain(password)
    expect(ARGON2_OPTIONS).toMatchObject({
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    })
  })

  it('salts every hash uniquely', async () => {
    const [a, b] = await Promise.all([
      hashPassword(password),
      hashPassword(password),
    ])
    expect(a).not.toBe(b)
  })

  it('verifies the correct password', async () => {
    const hash = await hashPassword(password)
    await expect(verifyPassword(hash, password)).resolves.toBe(true)
  })

  it.each([
    ['wrong password', 'correct horse battery stapler'],
    ['different case', password.toUpperCase()],
    ['empty string', ''],
    ['leading whitespace', ` ${password}`],
  ])('rejects a %s', async (_label, attempt) => {
    const hash = await hashPassword(password)
    await expect(verifyPassword(hash, attempt)).resolves.toBe(false)
  })

  it('returns false (does not throw) for a malformed stored hash', async () => {
    await expect(verifyPassword('not-a-hash', password)).resolves.toBe(false)
    await expect(verifyPassword('', password)).resolves.toBe(false)
  })

  it('supports long passphrases and unicode', async () => {
    const long = `${'pässwörd-🔑-'.repeat(10)}`
    const hash = await hashPassword(long)
    await expect(verifyPassword(hash, long)).resolves.toBe(true)
  })

  it('dummy verification never succeeds (timing equalization path)', async () => {
    await expect(verifyAgainstDummyHash(password)).resolves.toBe(false)
  })
})
