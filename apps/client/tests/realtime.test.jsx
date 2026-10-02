import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fakeSocketFactory } from './fakeSocket.js'
import {
  alice,
  apiError,
  fakeAuthApi,
  fakeChatApi,
  notSignedIn,
  publicRoom,
  renderApp,
} from './helpers.jsx'

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
}
const SERVER_EVENTS = [
  'message:new',
  'conversation:update',
  'typing:update',
  'message:read:update',
  'presence:update',
]

function message(n, sender = alice, conversationId = privateWithBob.id) {
  return {
    id: `65f00000000000000000${String(n).padStart(4, '0')}`,
    conversationId,
    sender: { id: sender.id, name: sender.name },
    content: `message ${n}`,
    clientMessageId: null,
    createdAt: new Date(Date.UTC(2026, 0, 3, 0, 0, n)).toISOString(),
  }
}

function setup({
  route = `/conversations/${privateWithBob.id}`,
  chat = {},
  auth,
} = {}) {
  const createSocket = fakeSocketFactory()
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
  const utils = renderApp({ route, authApi, chatApi, createSocket })
  return { ...utils, socket: () => createSocket.latest(), createSocket }
}

const live = () => screen.findByText('Live')
const messageTexts = () =>
  [...document.querySelectorAll('.message-content')].map((n) => n.textContent)

describe('connection lifecycle', () => {
  it('does not create a socket while signed out', async () => {
    const createSocket = fakeSocketFactory()
    renderApp({
      route: '/',
      authApi: fakeAuthApi({
        me: vi.fn(async () => {
          throw notSignedIn()
        }),
      }),
      createSocket,
    })
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(createSocket.sockets).toHaveLength(0)
  })

  it('connects once authenticated and shows the connection state', async () => {
    const { socket } = setup({ route: '/' })
    await live()
    expect(socket().connected).toBe(true)
    expect(socket().emittedEvents('presence:list')).toHaveLength(1)
  })

  it('disconnects and drops all listeners on sign out', async () => {
    const { socket } = setup({ route: '/' })
    await live()
    const current = socket()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(current.disconnectCalls).toBe(1)
    expect(current.totalListeners).toBe(0)
  })

  it('disconnects when the app unmounts', async () => {
    const { socket, unmount } = setup({ route: '/' })
    await live()
    const current = socket()
    unmount()
    expect(current.disconnectCalls).toBe(1)
    expect(current.totalListeners).toBe(0)
  })

  it('never accumulates socket listeners across navigation and re-renders', async () => {
    const { socket } = setup({ route: '/' })
    await live()
    const nav = await screen.findByRole('navigation', { name: 'Conversations' })
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(within(nav).getByRole('link', { name: /Bob Example/ }))
      await screen.findByLabelText('Message')
      fireEvent.click(within(nav).getByRole('link', { name: /General/ }))
      await screen.findByRole('heading', { name: 'General' })
    }
    for (const event of SERVER_EVENTS) {
      // one fan-out listener (+ the presence tracker for presence:update)
      expect(socket().listenerCount(event)).toBe(
        event === 'presence:update' ? 2 : 1,
      )
    }
    expect(socket().listenerCount('connect')).toBe(1)
  })

  it('shows reconnecting, then rejoins rooms and resyncs over REST', async () => {
    const listMessages = vi.fn(async () => ({
      messages: [message(1)],
      nextCursor: null,
    }))
    const { socket, chatApi } = setup({ chat: { listMessages } })
    await live()
    await screen.findByText('message 1')
    expect(socket().emittedEvents('conversation:join')).toEqual([
      { conversationId: privateWithBob.id },
    ])

    listMessages.mockResolvedValue({
      messages: [message(1), message(2, bob)],
      nextCursor: null,
    })
    act(() => {
      socket().simulateDisconnect()
      socket().simulateReconnectAttempt()
    })
    expect(await screen.findByText('Reconnecting…')).toBeInTheDocument()

    act(() => socket().simulateConnect())
    await live()
    // Missed while offline, recovered from durable history.
    expect(await screen.findByText('message 2')).toBeInTheDocument()
    expect(socket().emittedEvents('conversation:join')).toHaveLength(2)
    expect(chatApi.listConversations.mock.calls.length).toBeGreaterThanOrEqual(
      2,
    )
    expect(messageTexts()).toEqual(['message 1', 'message 2'])
  })

  it.each([
    [
      'an authentication error on (re)connect',
      (s) => s.simulateConnectError('AUTHENTICATION_INVALID'),
    ],
    [
      'a server-side disconnect (logout elsewhere)',
      (s) => s.simulateDisconnect('io server disconnect'),
    ],
  ])('re-checks the session after %s', async (_label, trigger) => {
    const me = vi
      .fn()
      .mockResolvedValueOnce(alice)
      .mockRejectedValue(apiError('AUTHENTICATION_INVALID', 401))
    const { socket } = setup({ route: '/', auth: fakeAuthApi({ me }) })
    await live()
    act(() => trigger(socket()))
    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(me).toHaveBeenCalledTimes(2)
  })
})

describe('live messages', () => {
  it('joins the open conversation and leaves it when navigating away', async () => {
    const { socket } = setup()
    await live()
    await screen.findByLabelText('Message')
    expect(socket().emittedEvents('conversation:join')).toEqual([
      { conversationId: privateWithBob.id },
    ])
    fireEvent.click(screen.getByRole('link', { name: 'Real-Time Chat' }))
    await screen.findByText(/Select a conversation/)
    expect(socket().emittedEvents('conversation:leave')).toEqual([
      { conversationId: privateWithBob.id },
    ])
  })

  it('refetches after the join completes so nothing in the join gap is missed', async () => {
    const listMessages = vi
      .fn()
      .mockResolvedValueOnce({ messages: [message(1)], nextCursor: null })
      // stored after the first fetch, before the join finished
      .mockResolvedValue({
        messages: [message(1), message(2, bob)],
        nextCursor: null,
      })
    const { socket } = setup({ chat: { listMessages } })
    await live()
    expect(await screen.findByText('message 2')).toBeInTheDocument()
    expect(messageTexts()).toEqual(['message 1', 'message 2'])
    expect(
      socket().emitted.filter((e) => e.event === 'conversation:join' && e.ack),
    ).toHaveLength(1)
  })

  it('shows incoming messages for the open conversation only', async () => {
    const { socket } = setup()
    await live()
    await screen.findByText('No messages yet. Say hello!')
    act(() => {
      socket().serverEmit('message:new', { message: message(5, bob) })
      socket().serverEmit('message:new', {
        message: message(6, bob, publicRoom.id),
      })
    })
    expect(await screen.findByText('message 5')).toBeInTheDocument()
    expect(screen.queryByText('message 6')).not.toBeInTheDocument()
  })

  it('ignores duplicate and out-of-order deliveries', async () => {
    const { socket } = setup({
      chat: {
        listMessages: vi.fn(async () => ({
          messages: [message(3)],
          nextCursor: null,
        })),
      },
    })
    await live()
    await screen.findByText('message 3')
    act(() => {
      socket().serverEmit('message:new', { message: message(4, bob) })
      socket().serverEmit('message:new', { message: message(2, bob) })
      socket().serverEmit('message:new', { message: message(4, bob) })
      socket().serverEmit('message:new', { message: message(3) })
    })
    await waitFor(() =>
      expect(messageTexts()).toEqual(['message 2', 'message 3', 'message 4']),
    )
  })

  it('sends over the socket and renders the acknowledged message once', async () => {
    const { socket } = setup()
    await live()
    const saved = { ...message(9), content: 'over the socket' }
    socket().respond('message:send', (payload) => ({
      success: true,
      data: {
        clientMessageId: payload.clientMessageId,
        messageId: saved.id,
        createdAt: saved.createdAt,
        duplicate: false,
        message: { ...saved, clientMessageId: payload.clientMessageId },
      },
    }))
    fireEvent.change(await screen.findByLabelText('Message'), {
      target: { value: ' over the socket ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('over the socket')).toBeInTheDocument()

    const [sent] = socket().emittedEvents('message:send')
    expect(sent).toEqual({
      conversationId: privateWithBob.id,
      content: 'over the socket',
      clientMessageId: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
    })
    // The same message broadcast to another tab of mine arrives too: no duplicate.
    act(() => socket().serverEmit('message:new', { message: saved }))
    expect(screen.getAllByText('over the socket')).toHaveLength(1)
  })

  it('keeps the draft when the server rejects the send', async () => {
    const { socket } = setup()
    await live()
    socket().respond('message:send', () => ({
      success: false,
      error: {
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      },
    }))
    const input = await screen.findByLabelText('Message')
    fireEvent.change(input, { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'do not have access',
    )
    expect(input).toHaveValue('nope')
  })

  it('retries safely with the same clientMessageId after a lost acknowledgement', async () => {
    const { socket } = setup()
    await live()
    socket().respond('message:send', () => {
      throw new Error('operation has timed out')
    })
    const input = await screen.findByLabelText('Message')
    fireEvent.change(input, { target: { value: 'did it arrive?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Send again to retry safely',
    )

    socket().respond('message:send', (payload) => ({
      success: true,
      data: {
        duplicate: true,
        message: {
          ...message(7),
          content: 'did it arrive?',
          clientMessageId: payload.clientMessageId,
        },
      },
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(
      await screen.findByText('did it arrive?', {
        selector: '.message-content',
      }),
    ).toBeInTheDocument()
    const [first, second] = socket().emittedEvents('message:send')
    expect(second.clientMessageId).toBe(first.clientMessageId)
  })

  it('updates the conversation list from conversation:update', async () => {
    const { socket } = setup({ route: '/' })
    await live()
    const nav = await screen.findByRole('navigation', { name: 'Conversations' })
    const fresh = {
      ...privateWithBob,
      id: '65f0000000000000000000d9',
      participants: [
        { id: alice.id, name: alice.name },
        { id: '65f000000000000000000009', name: 'Zoe New' },
      ],
      createdAt: '2026-02-01T00:00:00.000Z',
      lastMessageAt: '2026-02-01T00:00:00.000Z',
    }
    act(() =>
      socket().serverEmit('conversation:update', { conversation: fresh }),
    )
    const links = await within(nav).findAllByRole('link')
    expect(links[0]).toHaveTextContent('Zoe New')
    act(() =>
      socket().serverEmit('conversation:update', { conversation: fresh }),
    )
    expect(within(nav).getAllByRole('link', { name: /Zoe New/ })).toHaveLength(
      1,
    )
  })
})

describe('typing, read state and presence', () => {
  it('signals my typing and shows the other participant typing', async () => {
    const { socket } = setup()
    await live()
    const input = await screen.findByLabelText('Message')
    fireEvent.change(input, { target: { value: 'h' } })
    fireEvent.change(input, { target: { value: 'hi' } })
    expect(socket().emittedEvents('typing:start')).toEqual([
      { conversationId: privateWithBob.id },
    ])
    fireEvent.change(input, { target: { value: '' } })
    expect(socket().emittedEvents('typing:stop')).toEqual([
      { conversationId: privateWithBob.id },
    ])

    act(() =>
      socket().serverEmit('typing:update', {
        conversationId: privateWithBob.id,
        userId: bob.id,
        typing: true,
      }),
    )
    expect(
      await screen.findByText('Bob Example is typing…'),
    ).toBeInTheDocument()
    act(() =>
      socket().serverEmit('typing:update', {
        conversationId: privateWithBob.id,
        userId: bob.id,
        typing: false,
      }),
    )
    await waitFor(() =>
      expect(screen.queryByText(/is typing/)).not.toBeInTheDocument(),
    )
  })

  it('keeps typing state when unrelated presence changes arrive (regression)', async () => {
    const { socket } = setup()
    await live()
    const input = await screen.findByLabelText('Message')
    fireEvent.change(input, { target: { value: 'still typing' } })
    expect(socket().emittedEvents('typing:start')).toHaveLength(1)

    // Someone else comes online / goes offline while I am typing.
    act(() => {
      socket().serverEmit('presence:update', {
        userId: 'someone-else',
        status: 'online',
      })
      socket().serverEmit('presence:update', {
        userId: 'someone-else',
        status: 'offline',
      })
    })
    fireEvent.change(input, { target: { value: 'still typing more' } })

    expect(socket().emittedEvents('typing:stop')).toEqual([])
    expect(socket().emittedEvents('typing:start')).toHaveLength(1)
  })

  it('expires a typing state that never receives a stop', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { socket } = setup()
      await live()
      await screen.findByLabelText('Message')
      act(() =>
        socket().serverEmit('typing:update', {
          conversationId: privateWithBob.id,
          userId: bob.id,
          typing: true,
        }),
      )
      expect(screen.getByText('Bob Example is typing…')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(6000))
      expect(screen.queryByText(/is typing/)).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports reads of the newest incoming message and shows "Seen"', async () => {
    const { socket } = setup({
      chat: {
        listMessages: vi.fn(async () => ({
          messages: [message(1, bob), message(2, alice)],
          nextCursor: null,
        })),
      },
    })
    await live()
    await screen.findByText('message 2')
    await waitFor(() =>
      expect(socket().emittedEvents('message:read')).toEqual([
        { conversationId: privateWithBob.id, messageId: message(1).id },
      ]),
    )
    act(() =>
      socket().serverEmit('message:read:update', {
        conversationId: privateWithBob.id,
        messageId: message(2).id,
        userId: bob.id,
      }),
    )
    expect(await screen.findByText('Seen')).toBeInTheDocument()
  })

  it('shows presence from the initial list and live updates', async () => {
    const createSocket = fakeSocketFactory()
    const chatApi = fakeChatApi({
      listConversations: vi.fn(async () => ({
        conversations: [privateWithBob],
        nextCursor: null,
      })),
      getConversation: vi.fn(async () => privateWithBob),
    })
    renderApp({
      route: `/conversations/${privateWithBob.id}`,
      authApi: fakeAuthApi({ me: vi.fn(async () => alice) }),
      chatApi,
      createSocket: Object.assign(() => {
        const socket = createSocket()
        socket.respond('presence:list', () => ({
          success: true,
          data: { online: [bob.id] },
        }))
        return socket
      }, createSocket),
    })
    expect(
      await screen.findByTestId('conversation-presence'),
    ).toHaveTextContent('Online')
    expect(screen.getByText('(online)')).toBeInTheDocument()
    act(() =>
      createSocket
        .latest()
        .serverEmit('presence:update', { userId: bob.id, status: 'offline' }),
    )
    expect(
      await screen.findByTestId('conversation-presence'),
    ).toHaveTextContent('Offline')
    expect(screen.queryByText('(online)')).not.toBeInTheDocument()
  })
})
