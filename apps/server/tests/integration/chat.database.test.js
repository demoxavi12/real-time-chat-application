import { Types } from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { privateKeyFor } from '../../src/models/conversation.model.js'
import { createConversationRepository } from '../../src/repositories/conversation.repository.js'
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

const byName = (indexes) => Object.fromEntries(indexes.map((i) => [i.name, i]))

function planStages(explain) {
  const stages = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.stage) stages.push(node.stage)
    for (const value of Object.values(node)) walk(value)
  }
  walk(explain.queryPlanner.winningPlan)
  return stages
}

describe('indexes', () => {
  it('declares the conversation indexes with their constraints', async () => {
    const indexes = byName(await server.models.Conversation.listIndexes())
    expect(indexes.private_pair_unique).toMatchObject({
      key: { privateKey: 1 },
      unique: true,
      partialFilterExpression: { type: 'private' },
    })
    expect(indexes.public_room_singleton).toMatchObject({
      key: { type: 1 },
      unique: true,
      partialFilterExpression: { type: 'public' },
    })
    expect(indexes.participant_activity).toMatchObject({
      key: { participantIds: 1, lastActivityAt: -1, _id: -1 },
    })
  })

  it('declares the message indexes with their constraints', async () => {
    const indexes = byName(await server.models.Message.listIndexes())
    expect(indexes.conversation_history).toMatchObject({
      key: { conversationId: 1, createdAt: -1, _id: -1 },
    })
    expect(indexes.client_message_id_unique).toMatchObject({
      key: { conversationId: 1, senderId: 1, clientMessageId: 1 },
      unique: true,
      partialFilterExpression: { clientMessageId: { $type: 'string' } },
    })
  })

  it('serves message history pages from the history index (no collection scan)', async () => {
    const conversationId = new Types.ObjectId()
    const explain = await server.models.Message.find({
      conversationId,
      $or: [
        { createdAt: { $lt: new Date() } },
        { createdAt: new Date(), _id: { $lt: new Types.ObjectId() } },
      ],
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(31)
      .explain('queryPlanner')
    const stages = planStages(explain)
    expect(stages).toContain('IXSCAN')
    expect(stages).not.toContain('COLLSCAN')
    expect(JSON.stringify(explain.queryPlanner.winningPlan)).toContain(
      'conversation_history',
    )
  })

  it('serves conversation lists from indexes (no collection scan)', async () => {
    const userId = new Types.ObjectId()
    const explain = await server.models.Conversation.find({
      $or: [{ type: 'public' }, { participantIds: userId }],
    })
      .sort({ lastActivityAt: -1, _id: -1 })
      .limit(31)
      .explain('queryPlanner')
    expect(planStages(explain)).not.toContain('COLLSCAN')
  })
})

describe('database-level guarantees', () => {
  it('rejects a second private conversation for the same pair even when written directly', async () => {
    const a = new Types.ObjectId()
    const b = new Types.ObjectId()
    const doc = {
      type: 'private',
      participantIds: [a, b],
      privateKey: privateKeyFor(a, b),
    }
    await server.models.Conversation.create(doc)
    await expect(
      server.models.Conversation.create({ ...doc, participantIds: [b, a] }),
    ).rejects.toMatchObject({ code: 11000 })
  })

  it('rejects a second public room even when written directly', async () => {
    await expect(
      server.models.Conversation.create({ type: 'public', name: 'Another' }),
    ).rejects.toMatchObject({ code: 11000 })
  })

  it('recovers from the duplicate-key race by returning the winner', async () => {
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const winner = await alice.openPrivateWith(bob)

    // Simulate the race: our initial lookup misses (the other request had
    // not committed yet), so create() hits the unique index.
    const Conversation = server.models.Conversation
    let lookups = 0
    const racingModel = {
      findOne: (filter) => {
        lookups += 1
        return lookups === 1
          ? { exec: async () => null }
          : Conversation.findOne(filter)
      },
      create: (doc) => Conversation.create(doc),
    }
    const repo = createConversationRepository({ Conversation: racingModel })
    const result = await repo.openPrivate(bob.id, alice.id)

    expect(lookups).toBe(2)
    expect(result.created).toBe(false)
    expect(String(result.conversation._id)).toBe(winner.id)
  })

  it('creates one conversation for many simultaneous repository calls', async () => {
    const a = new Types.ObjectId()
    const b = new Types.ObjectId()
    const repo = createConversationRepository(server.models)
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        i % 2 ? repo.openPrivate(a, b) : repo.openPrivate(b, a),
      ),
    )
    expect(new Set(results.map((r) => String(r.conversation._id))).size).toBe(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
    expect(
      await server.models.Conversation.countDocuments({
        privateKey: privateKeyFor(a, b),
      }),
    ).toBe(1)
  })

  it('never stores client-controlled message timestamps', async () => {
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const conversation = await alice.openPrivateWith(bob)
    const before = Date.now()
    const message = await alice.send(conversation.id, 'server time')
    expect(Date.parse(message.createdAt)).toBeGreaterThanOrEqual(before - 1000)
  })
})
