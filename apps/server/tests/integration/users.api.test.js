import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signedInUser } from '../helpers/chat.js'
import { startTestServer } from '../helpers/server.js'

let server
let url

beforeAll(async () => {
  ;({ server, url } = await startTestServer())
})

afterAll(async () => {
  await server?.close()
})

describe('GET /api/users', () => {
  it('lists other users with only id and name', async () => {
    const me = await signedInUser(url, { name: 'Directory Owner' })
    const other = await signedInUser(url, { name: 'Directory Other' })
    const res = await me.get('/api/users?limit=50')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const ids = res.body.data.users.map((u) => u.id)
    expect(ids).toContain(other.id)
    expect(ids).not.toContain(me.id)
    for (const user of res.body.data.users) {
      expect(Object.keys(user).sort()).toEqual(['id', 'name'])
    }
    expect(res.text).not.toMatch(
      /passwordHash|argon2|@example\.test|lastSeenAt/,
    )
  })

  it('searches by case-insensitive name prefix', async () => {
    const me = await signedInUser(url)
    const target = await signedInUser(url, { name: 'Zelda Prefixmatch' })
    await signedInUser(url, { name: 'Somebody Zelda' })
    const res = await me.get('/api/users?q=zELDA')
    expect(res.body.data.users).toEqual([
      { id: target.id, name: 'Zelda Prefixmatch' },
    ])
  })

  it('finds a user by exact email without revealing emails', async () => {
    const me = await signedInUser(url)
    const target = await signedInUser(url)
    const res = await me.get(
      `/api/users?q=${encodeURIComponent(target.input.email.toUpperCase())}`,
    )
    expect(res.body.data.users).toEqual([
      { id: target.id, name: target.user.name },
    ])
    expect(res.text).not.toContain(target.input.email)

    const partial = await me.get(
      `/api/users?q=${encodeURIComponent(target.input.email.slice(0, 6))}@`,
    )
    expect(partial.body.data.users).toEqual([])
  })

  it('treats regex metacharacters literally', async () => {
    const me = await signedInUser(url)
    await signedInUser(url, { name: 'Regex Victim' })
    for (const q of ['.*', '^', '(a+)+$', '[', '\\']) {
      const res = await me.get(`/api/users?q=${encodeURIComponent(q)}`)
      expect(res.status).toBe(200)
      expect(res.body.data.users).toEqual([])
    }
  })

  it('paginates with a cursor without duplicates', async () => {
    const me = await signedInUser(url)
    const prefix = `Pager${Date.now()}`
    const created = []
    for (let i = 0; i < 5; i += 1) {
      created.push((await signedInUser(url, { name: `${prefix} ${i}` })).id)
    }
    const seen = []
    let cursor
    do {
      const res = await me.get(
        `/api/users?q=${prefix}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      )
      expect(res.status).toBe(200)
      seen.push(...res.body.data.users.map((u) => u.id))
      cursor = res.body.data.nextCursor
    } while (cursor)
    expect(seen.sort()).toEqual(created.sort())
  })

  it.each([
    ['limit above 50', '?limit=51'],
    ['empty q', '?q='],
    ['q too long', `?q=${'x'.repeat(51)}`],
    ['unknown parameter', '?role=admin'],
    ['operator injection', '?q[$regex]=.*'],
    ['invalid cursor', '?cursor=bm9wZQ'],
  ])('rejects %s', async (_label, query) => {
    const me = await signedInUser(url)
    const res = await me.get(`/api/users${query}`)
    expect(res.status).toBe(400)
    expect(['VALIDATION_ERROR', 'INVALID_CURSOR']).toContain(
      res.body.error.code,
    )
  })
})
