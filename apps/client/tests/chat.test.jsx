import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  alice,
  apiError,
  fakeAuthApi,
  fakeChatApi,
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

const signedIn = () => fakeAuthApi({ me: vi.fn(async () => alice) })
const location = () => screen.getByTestId('location').textContent

function renderChat({ route = '/', chat = {} } = {}) {
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
  return renderApp({ route, authApi: signedIn(), chatApi })
}

const conversationNav = () =>
  screen.findByRole('navigation', { name: 'Conversations' })

describe('conversation list', () => {
  it('shows the public room and private conversations named after the other user', async () => {
    renderChat()
    const nav = await conversationNav()
    await within(nav).findByRole('link', { name: /General/ })
    expect(within(nav).getByRole('link', { name: /General/ })).toHaveAttribute(
      'href',
      `/conversations/${publicRoom.id}`,
    )
    expect(
      within(nav).getByRole('link', { name: /Bob Example/ }),
    ).toHaveAttribute('href', `/conversations/${privateWithBob.id}`)
    expect(screen.getByText(/Select a conversation/)).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    renderChat({
      chat: {
        listConversations: vi.fn(async () => ({
          conversations: [],
          nextCursor: null,
        })),
      },
    })
    expect(await screen.findByText('No conversations yet.')).toBeInTheDocument()
  })

  it('shows a retryable error', async () => {
    const listConversations = vi
      .fn()
      .mockRejectedValueOnce(apiError('NETWORK_ERROR', 0))
      .mockResolvedValue({ conversations: [publicRoom], nextCursor: null })
    renderChat({ chat: { listConversations } })
    const nav = await conversationNav()
    const alert = await within(nav).findByRole('alert')
    expect(alert).toHaveTextContent('Unable to reach the server')
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(
      await within(nav).findByRole('link', { name: /General/ }),
    ).toBeInTheDocument()
  })

  it('loads more conversations with the cursor', async () => {
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({
        conversations: [publicRoom],
        nextCursor: 'next-1',
      })
      .mockResolvedValueOnce({
        conversations: [privateWithBob],
        nextCursor: null,
      })
    renderChat({ chat: { listConversations } })
    fireEvent.click(
      await screen.findByRole('button', { name: 'More conversations' }),
    )
    expect(
      await screen.findByRole('link', { name: /Bob Example/ }),
    ).toBeInTheDocument()
    expect(listConversations).toHaveBeenLastCalledWith({
      limit: 50,
      cursor: 'next-1',
    })
    expect(
      screen.queryByRole('button', { name: 'More conversations' }),
    ).not.toBeInTheDocument()
  })
})

describe('user discovery and starting a conversation', () => {
  it('finds a user and opens the private conversation', async () => {
    const carol = { id: '65f000000000000000000003', name: 'Carol Example' }
    const withCarol = {
      ...privateWithBob,
      id: '65f0000000000000000000d2',
      participants: [
        { id: alice.id, name: alice.name },
        { id: carol.id, name: carol.name },
      ],
    }
    const searchUsers = vi.fn(async () => ({
      users: [carol],
      nextCursor: null,
    }))
    const openPrivateConversation = vi.fn(async () => withCarol)
    renderChat({
      chat: {
        searchUsers,
        openPrivateConversation,
        getConversation: vi.fn(async () => withCarol),
      },
    })

    fireEvent.change(await screen.findByLabelText('Name or email'), {
      target: { value: '  Car ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Message Carol Example' }),
    )

    await waitFor(() =>
      expect(location()).toBe(`/conversations/${withCarol.id}`),
    )
    expect(searchUsers).toHaveBeenCalledWith({ q: 'Car', limit: 20 })
    expect(openPrivateConversation).toHaveBeenCalledWith(carol.id)
    expect(
      await screen.findByRole('heading', { name: 'Carol Example' }),
    ).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Conversations' })
    expect(
      within(nav).getByRole('link', { name: /Carol Example/ }),
    ).toBeInTheDocument()
  })

  it('reports when nobody matches', async () => {
    renderChat()
    fireEvent.change(await screen.findByLabelText('Name or email'), {
      target: { value: 'zzz' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('No users found.')).toBeInTheDocument()
  })

  it('does not search for blank input', async () => {
    const searchUsers = vi.fn()
    renderChat({ chat: { searchUsers } })
    fireEvent.change(await screen.findByLabelText('Name or email'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(searchUsers).not.toHaveBeenCalled()
  })

  it('shows API errors when opening fails', async () => {
    renderChat({
      chat: {
        searchUsers: vi.fn(async () => ({ users: [bob], nextCursor: null })),
        openPrivateConversation: vi.fn(async () => {
          throw apiError('USER_NOT_FOUND', 404)
        }),
      },
    })
    fireEvent.change(await screen.findByLabelText('Name or email'), {
      target: { value: 'Bob' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Message Bob Example' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That user no longer exists.',
    )
    expect(location()).toBe('/')
  })
})

describe('conversation history', () => {
  it('renders messages oldest first with sender names', async () => {
    renderChat({
      route: `/conversations/${privateWithBob.id}`,
      chat: {
        listMessages: vi.fn(async () => ({
          messages: [message(1, alice), message(2, bob)],
          nextCursor: null,
        })),
      },
    })
    const list = await screen.findByRole('list', { name: 'Messages' })
    const items = within(list).getAllByRole('listitem')
    expect(
      items.map((li) => li.querySelector('.message-content').textContent),
    ).toEqual(['message 1', 'message 2'])
    expect(items[1]).toHaveTextContent('Bob Example')
    expect(items[0]).toHaveClass('mine')
    expect(
      screen.getByRole('heading', { name: 'Bob Example' }),
    ).toBeInTheDocument()
  })

  it('shows an empty state for a new conversation', async () => {
    renderChat({ route: `/conversations/${privateWithBob.id}` })
    expect(
      await screen.findByText('No messages yet. Say hello!'),
    ).toBeInTheDocument()
  })

  it('loads older messages with the cursor and keeps chronological order', async () => {
    const listMessages = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [message(3), message(4)],
        nextCursor: 'older-1',
      })
      .mockResolvedValueOnce({
        messages: [message(1), message(2)],
        nextCursor: null,
      })
    renderChat({
      route: `/conversations/${privateWithBob.id}`,
      chat: { listMessages },
    })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Load older messages' }),
    )
    await waitFor(() =>
      expect(
        screen.getAllByText(/^message \d$/).map((n) => n.textContent),
      ).toEqual(['message 1', 'message 2', 'message 3', 'message 4']),
    )
    expect(listMessages).toHaveBeenLastCalledWith(privateWithBob.id, {
      limit: 30,
      before: 'older-1',
    })
    expect(
      screen.queryByRole('button', { name: 'Load older messages' }),
    ).not.toBeInTheDocument()
  })

  it('refresh fetches the latest messages without duplicating', async () => {
    const listMessages = vi
      .fn()
      .mockResolvedValueOnce({ messages: [message(1)], nextCursor: null })
      .mockResolvedValueOnce({
        messages: [message(1), message(2, bob)],
        nextCursor: null,
      })
    renderChat({
      route: `/conversations/${privateWithBob.id}`,
      chat: { listMessages },
    })
    await screen.findByText('message 1')
    const main = screen.getByRole('region', { name: 'Bob Example' })
    fireEvent.click(within(main).getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('message 2')).toBeInTheDocument()
    expect(screen.getAllByText('message 1')).toHaveLength(1)
  })

  it('shows not-found for an inaccessible conversation', async () => {
    renderChat({
      route: '/conversations/65f0000000000000000000ee',
      chat: {
        getConversation: vi.fn(async () => {
          throw apiError('CONVERSATION_NOT_FOUND', 404)
        }),
      },
    })
    expect(
      await screen.findByRole('heading', { name: 'Conversation not found' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument()
  })

  it('renders message content as text, never as HTML', async () => {
    const hostile = {
      ...message(1, bob),
      content: '<img src=x onerror="alert(1)">',
    }
    const { container } = renderChat({
      route: `/conversations/${privateWithBob.id}`,
      chat: {
        listMessages: vi.fn(async () => ({
          messages: [hostile],
          nextCursor: null,
        })),
      },
    })
    expect(await screen.findByText(hostile.content)).toBeInTheDocument()
    expect(container.querySelector('.message-content img')).toBeNull()
  })
})

describe('sending messages over REST', () => {
  function sendSetup(sendMessage) {
    renderChat({
      route: `/conversations/${privateWithBob.id}`,
      chat: { sendMessage },
    })
  }

  it('sends the trimmed text with a clientMessageId and shows the saved message', async () => {
    const saved = { ...message(9), content: 'Hello Bob' }
    const sendMessage = vi.fn(async () => saved)
    sendSetup(sendMessage)
    const input = await screen.findByLabelText('Message')
    fireEvent.change(input, { target: { value: '  Hello Bob  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Hello Bob')).toBeInTheDocument()
    expect(sendMessage).toHaveBeenCalledWith(privateWithBob.id, {
      content: 'Hello Bob',
      clientMessageId: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
    })
    expect(input).toHaveValue('')
  })

  it('moves the conversation to the top after sending', async () => {
    const sendMessage = vi.fn(async () => ({
      ...message(9),
      createdAt: '2030-01-01T00:00:00.000Z',
    }))
    sendSetup(sendMessage)
    fireEvent.change(await screen.findByLabelText('Message'), {
      target: { value: 'bump' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('message 9')
    const links = within(
      screen.getByRole('navigation', { name: 'Conversations' }),
    ).getAllByRole('link')
    expect(links[0]).toHaveTextContent('Bob Example')
  })

  it('validates before sending', async () => {
    const sendMessage = vi.fn()
    sendSetup(sendMessage)
    fireEvent.change(await screen.findByLabelText('Message'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Message cannot be empty',
    )
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('keeps the draft on failure and reuses the clientMessageId on retry', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(apiError('NETWORK_ERROR', 0))
      .mockResolvedValue({ ...message(9), content: 'retry me' })
    sendSetup(sendMessage)
    const input = await screen.findByLabelText('Message')
    fireEvent.change(input, { target: { value: 'retry me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to reach the server',
    )
    expect(input).toHaveValue('retry me')

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(
      await screen.findByText('retry me', { selector: '.message-content' }),
    ).toBeInTheDocument()
    const [first, second] = sendMessage.mock.calls
    expect(second[1].clientMessageId).toBe(first[1].clientMessageId)
  })

  it('sends on Enter but not on Shift+Enter', async () => {
    const sendMessage = vi.fn(async () => message(9))
    sendSetup(sendMessage)
    const input = await screen.findByLabelText('Message')
    fireEvent.change(input, { target: { value: 'line one' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(sendMessage).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
  })

  it('shows a loading state while sending', async () => {
    let resolve
    sendSetup(vi.fn(() => new Promise((r) => (resolve = r))))
    fireEvent.change(await screen.findByLabelText('Message'), {
      target: { value: 'slow' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(
      await screen.findByRole('button', { name: 'Sending…' }),
    ).toBeDisabled()
    resolve(message(9))
    expect(await screen.findByRole('button', { name: 'Send' })).toBeEnabled()
  })
})

describe('protection', () => {
  it('sends signed-out users from a conversation link to login and back after signing in', async () => {
    const chatApi = fakeChatApi({
      getConversation: vi.fn(async () => privateWithBob),
    })
    renderApp({ route: `/conversations/${privateWithBob.id}`, chatApi })
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(location()).toBe('/login')
    expect(chatApi.listConversations).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: alice.email },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'pw-123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(
      await screen.findByRole('heading', { name: 'Bob Example' }),
    ).toBeInTheDocument()
    expect(location()).toBe(`/conversations/${privateWithBob.id}`)
  })
})
