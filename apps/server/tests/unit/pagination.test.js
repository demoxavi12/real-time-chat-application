import { describe, expect, it } from 'vitest'
import {
  conversationCursor,
  messageCursor,
  toPage,
  userCursor,
} from '../../src/services/pagination.js'
import { decodeCursor, encodeCursor } from '../../src/utils/cursor.js'

const convId = '65f0000000000000000000c1'
const otherConvId = '65f0000000000000000000c2'
const msgId = '65f0000000000000000000a1'
const at = new Date('2026-01-01T12:00:00.000Z')

async function invalid(fn) {
  let error
  try {
    fn()
  } catch (err) {
    error = err
  }
  expect(error).toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' })
}

describe('cursor encoding', () => {
  it('round-trips message positions for the same conversation', () => {
    const cursor = messageCursor.encode({
      _id: msgId,
      conversationId: convId,
      createdAt: at,
    })
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(messageCursor.decode(cursor, convId)).toEqual({ at, id: msgId })
  })

  it('rejects a message cursor issued for another conversation', async () => {
    const cursor = messageCursor.encode({
      _id: msgId,
      conversationId: convId,
      createdAt: at,
    })
    await invalid(() => messageCursor.decode(cursor, otherConvId))
  })

  it('round-trips conversation and user cursors', () => {
    const c = conversationCursor.encode({ _id: convId, lastActivityAt: at })
    expect(conversationCursor.decode(c)).toEqual({ at, id: convId })
    const u = userCursor.encode({ _id: msgId })
    expect(userCursor.decode(u)).toEqual({ id: msgId })
  })

  it('rejects a cursor of a different kind', async () => {
    const userKind = userCursor.encode({ _id: msgId })
    await invalid(() => conversationCursor.decode(userKind))
    await invalid(() => messageCursor.decode(userKind, convId))
    const convKind = conversationCursor.encode({
      _id: convId,
      lastActivityAt: at,
    })
    await invalid(() => userCursor.decode(convKind))
  })

  it.each([
    ['not base64 JSON', 'bm90LWpzb24'],
    ['empty object', encodeCursor({})],
    ['array', encodeCursor([1, 2])],
    ['negative time', encodeCursor({ k: 'c', t: -1, id: convId })],
    ['fractional time', encodeCursor({ k: 'c', t: 1.5, id: convId })],
    ['bad id', encodeCursor({ k: 'c', t: 1, id: 'nope' })],
    ['operator object id', encodeCursor({ k: 'c', t: 1, id: { $gt: '' } })],
    ['extra fields', encodeCursor({ k: 'c', t: 1, id: convId, x: 1 })],
  ])('rejects a malformed cursor (%s)', async (_label, cursor) => {
    await invalid(() => conversationCursor.decode(cursor))
  })

  it('decodeCursor validates with the given schema', async () => {
    await invalid(() =>
      decodeCursor('%%%', { safeParse: () => ({ success: true }) }),
    )
  })
})

describe('toPage (limit + 1 keyset paging)', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i }))
  const encode = (row) => `after-${row.id}`

  it.each([
    ['no rows', 0, 0, null],
    ['fewer than the page size', 2, 2, null],
    ['exactly the page size', 3, 3, null],
    ['more than the page size', 4, 3, 'after-2'],
  ])('handles %s', (_label, count, returned, cursor) => {
    const page = toPage(rows(count), 3, encode)
    expect(page.items).toHaveLength(returned)
    expect(page.nextCursor).toBe(cursor)
  })
})
