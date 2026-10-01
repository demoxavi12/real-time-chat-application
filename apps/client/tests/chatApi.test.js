import { describe, expect, it, vi } from 'vitest'
import {
  conversationTitle,
  describeChatError,
  mergeMessages,
  newClientMessageId,
  sortConversations,
  validateMessage,
} from '../src/features/chat/chatModel.js'
import { createChatApi } from '../src/services/api/chatApi.js'

function setup(data = {}) {
  const http = {
    get: vi.fn(async () => data),
    request: vi.fn(async () => data),
  }
  return { api: createChatApi(http), http }
}

describe('chatApi', () => {
  it('builds list URLs with only defined query parameters', async () => {
    const { api, http } = setup()
    await api.listConversations()
    await api.listConversations({ limit: 10, cursor: 'abc' })
    expect(http.get.mock.calls.map((c) => c[0])).toEqual([
      '/conversations',
      '/conversations?limit=10&cursor=abc',
    ])
  })

  it('encodes ids and queries safely', async () => {
    const { api, http } = setup({ conversation: {} })
    await api.getConversation('../users')
    await api.searchUsers({ q: 'a&b=c d' })
    expect(http.get.mock.calls[0][0]).toBe('/conversations/..%2Fusers')
    expect(http.get.mock.calls[1][0]).toBe('/users?q=a%26b%3Dc+d')
  })

  it('opens a private conversation by user id only', async () => {
    const { api, http } = setup({ conversation: { id: 'c1' } })
    await expect(api.openPrivateConversation('u2')).resolves.toEqual({
      id: 'c1',
    })
    expect(http.request).toHaveBeenCalledWith('/conversations/private', {
      method: 'POST',
      body: { userId: 'u2' },
    })
  })

  it('sends only content and clientMessageId', async () => {
    const { api, http } = setup({ message: { id: 'm1' } })
    await expect(
      api.sendMessage('c1', {
        content: 'hi',
        clientMessageId: 'id-12345678',
        senderId: 'x',
      }),
    ).resolves.toEqual({ id: 'm1' })
    expect(http.request).toHaveBeenCalledWith('/conversations/c1/messages', {
      method: 'POST',
      body: { content: 'hi', clientMessageId: 'id-12345678' },
    })
  })

  it('pages message history with before', async () => {
    const { api, http } = setup()
    const signal = new AbortController().signal
    await api.listMessages('c1', { limit: 30, before: 'cur' }, { signal })
    expect(http.get).toHaveBeenCalledWith(
      '/conversations/c1/messages?limit=30&before=cur',
      {
        signal,
      },
    )
  })
})

describe('chat model helpers', () => {
  const me = 'u1'

  it('titles conversations from the current user point of view', () => {
    expect(conversationTitle({ type: 'public', name: 'General' }, me)).toBe(
      'General',
    )
    expect(
      conversationTitle(
        {
          type: 'private',
          participants: [
            { id: me, name: 'Me' },
            { id: 'u2', name: 'Bob' },
          ],
        },
        me,
      ),
    ).toBe('Bob')
    expect(
      conversationTitle(
        { type: 'private', participants: [{ id: me, name: 'Me' }] },
        me,
      ),
    ).toBe('Unknown user')
  })

  it('merges messages by id in (createdAt, id) order', () => {
    const t = '2026-01-01T00:00:00.000Z'
    const merged = mergeMessages(
      [
        { id: 'b', createdAt: t, content: 'old b' },
        { id: 'c', createdAt: '2026-01-01T00:00:01.000Z' },
      ],
      [
        { id: 'a', createdAt: t },
        { id: 'b', createdAt: t, content: 'new b' },
      ],
    )
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(merged[1].content).toBe('new b')
  })

  it('sorts conversations by last activity', () => {
    const sorted = sortConversations([
      { id: 'a', createdAt: '2026-01-01T00:00:00Z', lastMessageAt: null },
      {
        id: 'b',
        createdAt: '2025-01-01T00:00:00Z',
        lastMessageAt: '2026-02-01T00:00:00Z',
      },
    ])
    expect(sorted.map((c) => c.id)).toEqual(['b', 'a'])
  })

  it('validates message drafts like the server', () => {
    expect(validateMessage('  hi\r\n ')).toEqual({ text: 'hi' })
    expect(validateMessage(' ')).toEqual({ error: 'Message cannot be empty' })
    expect(validateMessage('x'.repeat(2001)).error).toMatch(/at most 2000/)
    expect(validateMessage('x'.repeat(2000)).text).toHaveLength(2000)
  })

  it('generates server-acceptable client message ids, even without randomUUID', () => {
    expect(newClientMessageId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    const original = globalThis.crypto.randomUUID
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: undefined,
        configurable: true,
      })
      expect(newClientMessageId()).toMatch(/^[0-9a-f]{32}$/)
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: original,
        configurable: true,
      })
    }
  })

  it('describes chat errors', () => {
    expect(describeChatError({ code: 'CONVERSATION_NOT_FOUND' })).toMatch(
      /do not have access/,
    )
    expect(
      describeChatError({
        code: 'VALIDATION_ERROR',
        details: [{ message: 'Message cannot be empty' }],
      }),
    ).toBe('Message cannot be empty')
    expect(describeChatError(new Error('x'))).toBe(
      'Something went wrong. Please try again.',
    )
  })
})
