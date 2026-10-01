import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createUserRepository,
  DuplicateEmailError,
} from '../../src/repositories/user.repository.js'
import { buildUserInput, registerUser } from '../helpers/auth.js'
import { startTestServer } from '../helpers/server.js'

let server
let url

beforeAll(async () => {
  ;({ server, url } = await startTestServer())
})

afterAll(async () => {
  await server?.close()
})

function indexesByName(indexes) {
  return Object.fromEntries(indexes.map((index) => [index.name, index]))
}

describe('database indexes (created at startup)', () => {
  it('enforces a unique index on users.email', async () => {
    const indexes = indexesByName(await server.models.User.listIndexes())
    expect(indexes.email_unique).toMatchObject({
      key: { email: 1 },
      unique: true,
    })
  })

  it('has a unique session index and a TTL index on revoked sessions', async () => {
    const indexes = indexesByName(
      await server.models.RevokedSession.listIndexes(),
    )
    expect(indexes.sessionId_unique).toMatchObject({
      key: { sessionId: 1 },
      unique: true,
    })
    expect(indexes.expiresAt_ttl).toMatchObject({
      key: { expiresAt: 1 },
      expireAfterSeconds: 0,
    })
  })
})

describe('stored user documents', () => {
  it('stores an Argon2id hash, never the plaintext password', async () => {
    const { input, user } = await registerUser(url)
    const raw = await server.database.connection
      .collection('users')
      .findOne({ email: input.email })
    expect(raw.passwordHash).toMatch(/^\$argon2id\$/)
    expect(JSON.stringify(raw)).not.toContain(input.password)
    expect(Object.keys(raw).sort()).toEqual(
      [
        '__v',
        '_id',
        'createdAt',
        'email',
        'lastSeenAt',
        'name',
        'passwordHash',
        'updatedAt',
      ].sort(),
    )
    expect(String(raw._id)).toBe(user.id)
  })

  it('does not load passwordHash unless explicitly requested', async () => {
    const { input } = await registerUser(url)
    const user = await server.models.User.findOne({ email: input.email })
    expect(user.passwordHash).toBeUndefined()
    expect(user.toJSON()).not.toHaveProperty('passwordHash')
  })

  it('normalizes email at the model layer too', async () => {
    const input = buildUserInput()
    const user = await server.models.User.create({
      name: input.name,
      email: `  ${input.email.toUpperCase()}  `,
      passwordHash: 'x',
    })
    expect(user.email).toBe(input.email)
  })

  it('rejects unknown fields instead of silently storing them', async () => {
    const { name, email } = buildUserInput()
    await expect(
      server.models.User.create({
        name,
        email,
        passwordHash: 'x',
        isAdmin: true,
      }),
    ).rejects.toThrow(/isAdmin/)
  })

  it('maps duplicate-key errors to DuplicateEmailError', async () => {
    const users = createUserRepository(server.models)
    const input = buildUserInput()
    await users.create({ ...input, passwordHash: 'h' })
    await expect(
      users.create({
        ...input,
        email: input.email.toUpperCase(),
        passwordHash: 'h',
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError)
  })

  it('findById returns null for malformed ids without querying', async () => {
    const users = createUserRepository(server.models)
    await expect(users.findById('not-an-id')).resolves.toBeNull()
    await expect(users.findById({ $ne: null })).resolves.toBeNull()
  })
})
