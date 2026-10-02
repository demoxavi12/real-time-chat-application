import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  dayLabel,
  groupMessages,
  previewOf,
  previewText,
  shortTime,
} from '../src/features/chat/chatModel.js'
import {
  alice,
  apiError,
  fakeAuthApi,
  fakeChatApi,
  notSignedIn,
  publicRoom,
  renderApp,
} from './helpers.jsx'
import { fakeSocketFactory } from './fakeSocket.js'

const bob = { id: '65f000000000000000000002', name: 'Bob Example' }
const privateWithBob = {
  id: '65f0000000000000000000d1',
  type: 'private',
  name: null,
  participants: [
    { id: alice.id, name: alice.name },
    { id: bob.id, name: bob.name },
  ],
  createdAt: '2026-01-02T00:00:00.000Z',
  lastMessageAt: null,
  lastMessage: null,
}

function message(n, sender = alice, extra = {}) {
  return {
    id: `65f00000000000000000${String(n).padStart(4, '0')}`,
    conversationId: privateWithBob.id,
    sender: { id: sender.id, name: sender.name },
    content: `message ${n}`,
    clientMessageId: null,
    createdAt: new Date(Date.UTC(2026, 0, 3, 0, 0, n)).toISOString(),
    seen: false,
    ...extra,
  }
}

const at = (iso, sender = alice, n = 1) => ({
  ...message(n, sender),
  createdAt: iso,
})

function setup({ route = '/', chat = {}, auth, createSocket } = {}) {
  const socketFactory = createSocket ?? fakeSocketFactory()
  const chatApi = fakeChatApi({
    listConversations: vi.fn(async () => ({
      conversations: [publicRoom, privateWithBob],
      nextCursor: null,
    })),
    getConversation: vi.fn(async (id) =>
      id === publicRoom.id ? publicRoom : privateWithBob,
    ),
    ...chat,
  })
  const authApi = auth ?? fakeAuthApi({ me: vi.fn(async () => alice) })
  const utils = renderApp({
    route,
    authApi,
    chatApi,
    createSocket: socketFactory,
  })
  return { ...utils, socket: () => socketFactory.latest?.() }
}

describe('chat model helpers', () => {
  const now = new Date('2026-03-10T12:00:00')

  it('labels days relative to now', () => {
    expect(dayLabel('2026-03-10T08:00:00', now)).toBe('Today')
    expect(dayLabel('2026-03-09T23:59:00', now)).toBe('Yesterday')
    expect(dayLabel('2026-03-01T10:00:00', now)).not.toMatch(/Today|Yesterday/)
  })

  it('formats compact list times', () => {
    const t = Date.parse('2026-03-10T12:00:00Z')
    expect(shortTime('2026-03-10T11:59:30Z', t)).toBe('now')
    expect(shortTime('2026-03-10T11:55:00Z', t)).toBe('5m')
    expect(shortTime('2026-03-10T09:00:00Z', t)).toBe('3h')
    expect(shortTime('2026-03-01T09:00:00Z', t)).not.toMatch(/^(now|\d+[mh])$/)
  })

  it('groups consecutive messages from one sender within five minutes', () => {
    const rows = groupMessages(
      [
        at('2026-03-10T10:00:00', alice, 1),
        at('2026-03-10T10:04:00', alice, 2),
        at('2026-03-10T10:10:00', alice, 3),
        at('2026-03-10T10:11:00', bob, 4),
      ],
      now,
    )
    expect(rows.map((r) => r.grouped)).toEqual([false, true, false, false])
    expect(rows.map((r) => r.dayLabel)).toEqual(['Today', null, null, null])
  })

  it('starts a new group and day label when the day changes', () => {
    const rows = groupMessages(
      [
        at('2026-03-09T23:59:00', alice, 1),
        at('2026-03-10T00:01:00', alice, 2),
      ],
      now,
    )
    expect(rows.map((r) => [r.grouped, r.dayLabel])).toEqual([
      [false, 'Yesterday'],
      [false, 'Today'],
    ])
  })

  it('builds one-line bounded previews', () => {
    expect(previewOf('  hello\n\n  world ')).toBe('hello world')
    const long = previewOf('x'.repeat(500))
    expect(long).toHaveLength(120)
    expect(long.endsWith('…')).toBe(true)
  })

  it('prefixes previews with the sender', () => {
    const last = (sender) => ({
      lastMessage: {
        id: '1',
        sender,
        preview: 'hi',
        createdAt: '2026-01-01T00:00:00Z',
      },
    })
    expect(
      previewText(last({ id: alice.id, name: alice.name }), alice.id),
    ).toBe('You: hi')
    expect(previewText(last({ id: bob.id, name: bob.name }), alice.id)).toBe(
      'Bob Example: hi',
    )
    expect(previewText({ lastMessage: null }, alice.id)).toBe('No messages yet')
  })
})

describe('conversation list details', () => {
  it('shows the latest message preview and names links by title only', async () => {
    const withPreview = {
      ...privateWithBob,
      lastMessageAt: '2026-01-03T00:00:05.000Z',
      lastMessage: {
        id: message(5).id,
        sender: { id: bob.id, name: bob.name },
        preview: 'see you soon',
        createdAt: '2026-01-03T00:00:05.000Z',
      },
    }
    setup({
      chat: {
        listConversations: vi.fn(async () => ({
          conversations: [withPreview, publicRoom],
          nextCursor: null,
        })),
      },
    })
    const nav = await screen.findByRole('navigation', { name: 'Conversations' })
    const bobLink = await within(nav).findByRole('link', {
      name: 'Bob Example',
    })
    expect(bobLink).toHaveAccessibleDescription(
      expect.stringContaining('Bob Example: see you soon'),
    )
    expect(
      within(nav).getByRole('link', { name: 'General' }),
    ).toHaveAccessibleDescription(expect.stringContaining('No messages yet'))
  })

  it('updates the preview after I send a message', async () => {
    const sendMessage = vi.fn(async () => ({
      ...message(9),
      content: 'fresh news',
      createdAt: '2030-01-01T00:00:00.000Z',
    }))
    setup({
      route: `/conversations/${privateWithBob.id}`,
      chat: { sendMessage },
      createSocket: fakeSocketFactory({ autoConnect: false }),
    })
    fireEvent.change(await screen.findByLabelText('Message'), {
      target: { value: 'fresh news' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const nav = screen.getByRole('navigation', { name: 'Conversations' })
    await waitFor(() =>
      expect(
        within(nav).getByRole('link', { name: 'Bob Example' }),
      ).toHaveAccessibleDescription(expect.stringContaining('You: fresh news')),
    )
  })
})

describe('message rendering', () => {
  it('labels my messages "You" and groups consecutive messages', async () => {
    setup({
      route: `/conversations/${privateWithBob.id}`,
      chat: {
        listMessages: vi.fn(async () => ({
          messages: [message(1, bob), message(2, bob), message(3)],
          nextCursor: null,
        })),
      },
    })
    const list = await screen.findByRole('list', { name: 'Messages' })
    const items = within(list).getAllByRole('listitem')
    expect(items[0]).toHaveClass('theirs')
    expect(items[0]).not.toHaveClass('grouped')
    expect(items[1]).toHaveClass('grouped')
    // Grouped messages still carry the sender for assistive technology.
    expect(items[1].querySelector('.visually-hidden')).toHaveTextContent(
      'Bob Example',
    )
    expect(items[2]).toHaveClass('mine')
    expect(within(items[2]).getByText('You')).toBeInTheDocument()
    expect(items[0].querySelector('.day-divider')).not.toBeNull()
    expect(items[1].querySelector('.day-divider')).toBeNull()
  })

  it('shows "Sent" on my latest message and "Seen" once the server says so', async () => {
    setup({
      route: `/conversations/${privateWithBob.id}`,
      createSocket: fakeSocketFactory({ autoConnect: false }),
      chat: {
        listMessages: vi.fn(async () => ({
          messages: [message(1), message(2, bob), message(3)],
          nextCursor: null,
        })),
      },
    })
    const list = await screen.findByRole('list', { name: 'Messages' })
    const items = within(list).getAllByRole('listitem')
    expect(within(items[2]).getByText('Sent')).toBeInTheDocument()
    expect(items[0].querySelector('.message-receipt')).toBeNull()
    expect(items[1].querySelector('.message-receipt')).toBeNull()
  })

  it('restores "Seen" from history after a reload', async () => {
    setup({
      route: `/conversations/${privateWithBob.id}`,
      createSocket: fakeSocketFactory({ autoConnect: false }),
      chat: {
        listMessages: vi.fn(async () => ({
          messages: [message(1, alice, { seen: true })],
          nextCursor: null,
        })),
      },
    })
    expect(await screen.findByText('Seen')).toBeInTheDocument()
  })

  it('never shows "Seen" in the public room', async () => {
    setup({
      route: `/conversations/${publicRoom.id}`,
      createSocket: fakeSocketFactory({ autoConnect: false }),
      chat: {
        listMessages: vi.fn(async () => ({
          messages: [
            { ...message(1), conversationId: publicRoom.id, seen: null },
          ],
          nextCursor: null,
        })),
      },
    })
    expect(await screen.findByText('Sent')).toBeInTheDocument()
    expect(screen.queryByText('Seen')).not.toBeInTheDocument()
  })
})

describe('duplicate send protection', () => {
  it('sends once when Enter and Send fire in the same tick', async () => {
    let resolve
    const sendMessage = vi.fn(() => new Promise((r) => (resolve = r)))
    setup({
      route: `/conversations/${privateWithBob.id}`,
      chat: { sendMessage },
      createSocket: fakeSocketFactory({ autoConnect: false }),
    })
    const input = await screen.findByLabelText('Message')
    fireEvent.change(input, { target: { value: 'only once' } })
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(sendMessage).toHaveBeenCalledOnce()
    await act(async () => resolve({ ...message(9), content: 'only once' }))
    expect(
      await screen.findByText('only once', { selector: '.message-content' }),
    ).toBeInTheDocument()
    expect(sendMessage).toHaveBeenCalledOnce()
  })
})

describe('scrolling and new messages', () => {
  function fakeLayout(el, { scrollHeight, clientHeight, scrollTop }) {
    let top = scrollTop
    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
    Object.defineProperty(el, 'clientHeight', {
      configurable: true,
      get: () => clientHeight,
    })
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v) => {
        top = v
      },
    })
  }

  it('offers a "New messages" button instead of jumping while reading history', async () => {
    const { socket } = setup({
      route: `/conversations/${privateWithBob.id}`,
      chat: {
        listMessages: vi.fn(async () => ({
          messages: [message(1, bob), message(2, bob)],
          nextCursor: null,
        })),
      },
    })
    await screen.findByText('Live')
    await screen.findByText('message 2')
    const log = screen.getByRole('log', { name: 'Message history' })
    fakeLayout(log, { scrollHeight: 2000, clientHeight: 300, scrollTop: 100 })
    fireEvent.scroll(log)

    act(() => socket().serverEmit('message:new', { message: message(3, bob) }))
    await screen.findByText('message 3')
    const button = await screen.findByRole('button', { name: /New messages/ })
    expect(log.scrollTop).toBe(100)

    fireEvent.click(button)
    expect(log.scrollTop).toBe(2000)
    expect(
      screen.queryByRole('button', { name: /New messages/ }),
    ).not.toBeInTheDocument()
  })

  it('follows new messages when already at the bottom', async () => {
    const { socket } = setup({
      route: `/conversations/${privateWithBob.id}`,
      chat: {
        listMessages: vi.fn(async () => ({
          messages: [message(1, bob)],
          nextCursor: null,
        })),
      },
    })
    await screen.findByText('Live')
    await screen.findByText('message 1')
    const log = screen.getByRole('log', { name: 'Message history' })
    fakeLayout(log, { scrollHeight: 900, clientHeight: 300, scrollTop: 600 })
    fireEvent.scroll(log)

    act(() => socket().serverEmit('message:new', { message: message(2, bob) }))
    await screen.findByText('message 2')
    expect(log.scrollTop).toBe(900)
    expect(
      screen.queryByRole('button', { name: /New messages/ }),
    ).not.toBeInTheDocument()
  })
})

describe('layout and focus', () => {
  it('marks the layout while a conversation is open and offers a way back', async () => {
    const { container } = setup({
      route: `/conversations/${privateWithBob.id}`,
    })
    await screen.findByRole('heading', { name: 'Bob Example' })
    expect(container.querySelector('.chat-layout')).toHaveClass(
      'conversation-open',
    )
    fireEvent.click(screen.getByRole('link', { name: /Back to conversations/ }))
    await screen.findByRole('heading', { name: 'Welcome' })
    expect(container.querySelector('.chat-layout')).not.toHaveClass(
      'conversation-open',
    )
  })

  it('moves focus to the conversation heading when it opens', async () => {
    setup({ route: `/conversations/${privateWithBob.id}` })
    const heading = await screen.findByRole('heading', { name: 'Bob Example' })
    await waitFor(() => expect(heading).toHaveFocus())
  })
})

describe('session expiry', () => {
  it('returns to sign in with an explanation when the session ends mid-use', async () => {
    const me = vi
      .fn()
      .mockResolvedValueOnce(alice)
      .mockRejectedValue(notSignedIn())
    const listMessages = vi.fn(async () => {
      throw apiError('AUTHENTICATION_REQUIRED', 401)
    })
    setup({
      route: `/conversations/${privateWithBob.id}`,
      auth: fakeAuthApi({ me }),
      chat: { listMessages },
      createSocket: fakeSocketFactory({ autoConnect: false }),
    })
    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your session has ended. Please sign in again.',
    )
    expect(me).toHaveBeenCalledTimes(2)
  })

  it('shows no expiry notice after an explicit sign out', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(screen.queryByText(/session has ended/)).not.toBeInTheDocument()
  })

  it('does not show the notice to a visitor who was never signed in', async () => {
    renderApp({ route: '/login' })
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(screen.queryByText(/session has ended/)).not.toBeInTheDocument()
  })
})
