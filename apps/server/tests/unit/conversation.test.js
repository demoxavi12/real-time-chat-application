import { Mongoose, Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import {
  conversationSchema,
  privateKeyFor,
} from '../../src/models/conversation.model.js'
import { conversationAccess } from '../../src/policies/conversationAccess.policy.js'
import { escapeRegExp } from '../../src/repositories/user.repository.js'
import {
  canAccessConversation,
  createConversationService,
  toPublicConversation,
} from '../../src/services/conversation.service.js'
import { toPublicMessage } from '../../src/services/message.service.js'
import { toDirectoryUser } from '../../src/services/userDirectory.service.js'

const alice = new Types.ObjectId()
const bob = new Types.ObjectId()
const carol = new Types.ObjectId()
const Conversation = new Mongoose().model('Conversation', conversationSchema)

async function validationError(doc) {
  return new Conversation(doc).validate().then(
    () => null,
    (error) => error,
  )
}

describe('privateKeyFor', () => {
  it('is the same regardless of who opens the conversation', () => {
    expect(privateKeyFor(alice, bob)).toBe(privateKeyFor(bob, alice))
    expect(privateKeyFor(alice, bob)).not.toBe(privateKeyFor(alice, carol))
  })
})

describe('conversation model invariants', () => {
  it('accepts a well-formed private conversation', async () => {
    expect(
      await validationError({
        type: 'private',
        participantIds: [alice, bob],
        privateKey: privateKeyFor(alice, bob),
      }),
    ).toBeNull()
  })

  it.each([
    ['one participant', [alice]],
    ['three participants', [alice, bob, carol]],
    ['the same user twice', [alice, alice]],
  ])(
    'rejects a private conversation with %s',
    async (_label, participantIds) => {
      const error = await validationError({
        type: 'private',
        participantIds,
        privateKey: privateKeyFor(participantIds[0], participantIds.at(-1)),
      })
      expect(error?.errors.participantIds).toBeDefined()
    },
  )

  it('rejects a privateKey that does not match the participants', async () => {
    const error = await validationError({
      type: 'private',
      participantIds: [alice, bob],
      privateKey: privateKeyFor(alice, carol),
    })
    expect(error?.errors.privateKey).toBeDefined()
  })

  it('rejects a public room with participants or a privateKey', async () => {
    expect(
      await validationError({ type: 'public', participantIds: [alice] }),
    ).not.toBeNull()
    expect(
      await validationError({ type: 'public', privateKey: 'x' }),
    ).not.toBeNull()
    expect(
      await validationError({ type: 'public', name: 'General' }),
    ).toBeNull()
  })

  it('rejects unsupported types and unknown fields', async () => {
    expect(await validationError({ type: 'group' })).not.toBeNull()
    expect(
      () => new Conversation({ type: 'public', admins: [alice] }),
    ).toThrow()
  })
})

describe('canAccessConversation', () => {
  const privateConversation = { type: 'private', participantIds: [alice, bob] }

  it('allows the two participants of a private conversation', () => {
    expect(canAccessConversation(privateConversation, alice)).toBe(true)
    expect(canAccessConversation(privateConversation, String(bob))).toBe(true)
  })

  it('denies everyone else', () => {
    expect(canAccessConversation(privateConversation, carol)).toBe(false)
    expect(canAccessConversation(privateConversation, undefined)).toBe(false)
  })

  it('allows every authenticated user into the public room', () => {
    expect(
      canAccessConversation({ type: 'public', participantIds: [] }, carol),
    ).toBe(true)
  })
})

describe('conversation service', () => {
  function service({ conversation = null, user = null } = {}) {
    return createConversationService({
      conversations: {
        findById: vi.fn(async () => conversation),
        openPrivate: vi.fn(async () => ({
          conversation: { _id: 'c' },
          created: true,
        })),
      },
      users: {
        findById: vi.fn(async () => user),
        findNamesByIds: vi.fn(async () => []),
      },
    })
  }

  it('reports missing and inaccessible conversations identically (404)', async () => {
    const missing = await service()
      .getAccessible('x', alice)
      .catch((e) => e)
    const foreign = await service({
      conversation: { type: 'private', participantIds: [bob, carol] },
    })
      .getAccessible('x', alice)
      .catch((e) => e)
    for (const error of [missing, foreign]) {
      expect(error).toMatchObject({
        statusCode: 404,
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      })
    }
  })

  it('refuses a private conversation with yourself', async () => {
    await expect(
      service().openPrivate(alice, String(alice)),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_PARTICIPANT',
    })
  })

  it('refuses unknown target users', async () => {
    await expect(
      service().openPrivate(alice, String(bob)),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    })
  })
})

describe('conversationAccess policy', () => {
  it('authorizes with the authenticated identity, never request data', async () => {
    const getAccessible = vi.fn(async () => ({ _id: 'c1' }))
    const req = {
      auth: { userId: String(alice) },
      validated: { params: { conversationId: 'c1' } },
      body: { userId: String(bob) },
      query: { userId: String(bob) },
    }
    await expect(conversationAccess({ getAccessible })(req)).resolves.toBe(true)
    expect(getAccessible).toHaveBeenCalledWith('c1', String(alice))
    expect(req.conversation).toEqual({ _id: 'c1' })
  })
})

describe('public representations', () => {
  const createdAt = new Date('2026-01-01T00:00:00Z')

  it('conversation exposes only ids, names and timestamps', () => {
    const names = new Map([[String(alice), 'Alice']])
    expect(
      toPublicConversation(
        {
          _id: 'c1',
          type: 'private',
          name: null,
          participantIds: [alice, bob],
          privateKey: 'secret-ish',
          createdBy: alice,
          createdAt,
          lastMessageAt: null,
        },
        names,
      ),
    ).toEqual({
      id: 'c1',
      type: 'private',
      name: null,
      participants: [
        { id: String(alice), name: 'Alice' },
        { id: String(bob), name: null },
      ],
      createdAt: createdAt.toISOString(),
      lastMessageAt: null,
    })
  })

  it('message exposes sender id/name and content, not read state', () => {
    expect(
      toPublicMessage(
        {
          _id: 'm1',
          conversationId: 'c1',
          senderId: alice,
          content: '<b>hi</b>',
          readBy: [alice],
          createdAt,
        },
        'Alice',
      ),
    ).toEqual({
      id: 'm1',
      conversationId: 'c1',
      sender: { id: String(alice), name: 'Alice' },
      content: '<b>hi</b>',
      clientMessageId: null,
      createdAt: createdAt.toISOString(),
    })
  })

  it('directory users expose only id and name', () => {
    expect(
      toDirectoryUser({
        _id: alice,
        name: 'Alice',
        email: 'a@example.test',
        passwordHash: 'h',
      }),
    ).toEqual({ id: String(alice), name: 'Alice' })
  })
})

describe('escapeRegExp', () => {
  it('neutralizes every regex metacharacter', () => {
    const hostile = '.*+?^${}()|[]\\'
    const pattern = new RegExp(`^${escapeRegExp(hostile)}$`)
    expect(pattern.test(hostile)).toBe(true)
    expect(pattern.test('anything')).toBe(false)
  })
})
