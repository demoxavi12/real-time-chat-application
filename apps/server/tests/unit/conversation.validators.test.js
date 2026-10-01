import { describe, expect, it } from 'vitest'
import { objectIdSchema } from '../../src/validators/common.validators.js'
import {
  conversationParamsSchema,
  listMessagesQuerySchema,
  listUsersQuerySchema,
  openPrivateConversationSchema,
  sendMessageSchema,
} from '../../src/validators/conversation.validators.js'

const id = '65F00000000000000000ABCD'

describe('objectIdSchema', () => {
  it('accepts and lower-cases a 24-hex id', () => {
    expect(objectIdSchema.parse(id)).toBe(id.toLowerCase())
  })

  it.each([
    '',
    'abc',
    `${id}0`,
    'zzzzzzzzzzzzzzzzzzzzzzzz',
    12345,
    { $ne: null },
    null,
  ])('rejects %o', (value) => {
    expect(objectIdSchema.safeParse(value).success).toBe(false)
  })
})

describe('sendMessageSchema', () => {
  it('trims surrounding whitespace and normalizes line endings', () => {
    expect(sendMessageSchema.parse({ content: '  hi\r\nthere\r  ' })).toEqual({
      content: 'hi\nthere',
    })
  })

  it('keeps inner newlines and tabs', () => {
    expect(sendMessageSchema.parse({ content: 'a\n\tb' }).content).toBe(
      'a\n\tb',
    )
  })

  it('accepts exactly 2000 characters and rejects 2001', () => {
    expect(
      sendMessageSchema.safeParse({ content: 'x'.repeat(2000) }).success,
    ).toBe(true)
    expect(
      sendMessageSchema.safeParse({ content: 'x'.repeat(2001) }).success,
    ).toBe(false)
  })

  it('counts length after trimming', () => {
    const padded = `   ${'x'.repeat(2000)}   `
    expect(sendMessageSchema.parse({ content: padded }).content).toHaveLength(
      2000,
    )
  })

  it.each([
    ['empty', { content: '' }],
    ['whitespace only', { content: ' \n\t ' }],
    ['missing', {}],
    ['not a string', { content: 42 }],
    ['an object', { content: { $gt: '' } }],
    ['control characters', { content: 'bell\u0007' }],
    ['huge input', { content: 'x'.repeat(5000) }],
  ])('rejects %s content', (_label, body) => {
    expect(sendMessageSchema.safeParse(body).success).toBe(false)
  })

  it.each([
    'senderId',
    'conversationId',
    'createdAt',
    'readBy',
    '_id',
    'sender',
  ])('rejects client-supplied %s', (field) => {
    const result = sendMessageSchema.safeParse({ content: 'hi', [field]: 'x' })
    expect(result.success).toBe(false)
    expect(result.error.issues[0].code).toBe('unrecognized_keys')
  })

  it('validates clientMessageId', () => {
    expect(
      sendMessageSchema.safeParse({
        content: 'hi',
        clientMessageId: 'abc-123_XYZ',
      }).success,
    ).toBe(true)
    for (const bad of ['short', 'x'.repeat(65), 'has space id', '<script>12']) {
      expect(
        sendMessageSchema.safeParse({ content: 'hi', clientMessageId: bad })
          .success,
      ).toBe(false)
    }
  })
})

describe('query and param schemas', () => {
  it('bounds message page size and defaults to 30', () => {
    expect(listMessagesQuerySchema.parse({})).toEqual({ limit: 30 })
    expect(listMessagesQuerySchema.parse({ limit: '100' }).limit).toBe(100)
    for (const limit of ['0', '101', '-1', '2.5', 'abc', ['1', '2']]) {
      expect(listMessagesQuerySchema.safeParse({ limit }).success).toBe(false)
    }
  })

  it('rejects unknown query parameters and malformed cursors', () => {
    expect(listMessagesQuerySchema.safeParse({ offset: '10' }).success).toBe(
      false,
    )
    expect(listMessagesQuerySchema.safeParse({ before: 'a b' }).success).toBe(
      false,
    )
    expect(
      listMessagesQuerySchema.safeParse({ before: 'x'.repeat(300) }).success,
    ).toBe(false)
  })

  it('accepts only userId when opening a private conversation', () => {
    expect(openPrivateConversationSchema.parse({ userId: id })).toEqual({
      userId: id.toLowerCase(),
    })
    expect(
      openPrivateConversationSchema.safeParse({
        userId: id,
        participantIds: [id],
      }).success,
    ).toBe(false)
    expect(openPrivateConversationSchema.safeParse({}).success).toBe(false)
  })

  it('validates the conversation route id', () => {
    expect(
      conversationParamsSchema.safeParse({ conversationId: 'abc' }).success,
    ).toBe(false)
  })

  it('bounds user search', () => {
    expect(listUsersQuerySchema.parse({ q: '  ad  ' })).toEqual({
      q: 'ad',
      limit: 20,
    })
    expect(listUsersQuerySchema.safeParse({ q: 'x'.repeat(51) }).success).toBe(
      false,
    )
    expect(listUsersQuerySchema.safeParse({ q: '   ' }).success).toBe(false)
    expect(listUsersQuerySchema.safeParse({ limit: '51' }).success).toBe(false)
    expect(
      listUsersQuerySchema.safeParse({ q: { $regex: '.*' } }).success,
    ).toBe(false)
  })
})
