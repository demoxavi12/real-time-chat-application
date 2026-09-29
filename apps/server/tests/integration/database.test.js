import net from 'node:net'
import { afterEach, describe, expect, inject, it } from 'vitest'
import {
  createDatabase,
  DatabaseConnectionError,
} from '../../src/config/database.js'
import {
  createMemoryLogger,
  silentLogger,
  uniqueDbName,
  withDatabase,
} from '../helpers/testEnv.js'

/** A loopback port with nothing listening on it. */
async function unusedPort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

describe('database connection', () => {
  let database

  afterEach(async () => {
    await database?.disconnect()
    database = undefined
  })

  it('connects, answers pings and disconnects cleanly', async () => {
    const dbName = uniqueDbName('db')
    const { logger, lines } = createMemoryLogger('debug')
    database = createDatabase({
      uri: withDatabase(inject('mongoUri'), dbName),
      logger,
    })

    await expect(database.ping()).rejects.toThrow('not connected')
    const connection = await database.connect()
    expect(connection.name).toBe(dbName)
    expect(connection.readyState).toBe(1)
    await expect(database.ping()).resolves.toBeUndefined()

    await database.disconnect()
    expect(connection.readyState).toBe(0)
    await expect(database.ping()).rejects.toThrow('not connected')
    expect(() => database.connection).toThrow('not connected')
    expect(lines.map((line) => line.msg)).toEqual([
      'database connected',
      'database connection closed',
    ])
  })

  it('reuses the existing connection on repeated connect()', async () => {
    database = createDatabase({
      uri: withDatabase(inject('mongoUri'), uniqueDbName('db')),
      logger: silentLogger,
    })
    const first = await database.connect()
    await expect(database.connect()).resolves.toBe(first)
  })

  it('does not buffer queries while disconnected', async () => {
    database = createDatabase({
      uri: withDatabase(inject('mongoUri'), uniqueDbName('db')),
      logger: silentLogger,
    })
    const connection = await database.connect()
    expect(connection.get('bufferCommands')).toBe(false)
  })

  it('fails clearly when MongoDB is unreachable', async () => {
    const port = await unusedPort()
    database = createDatabase({
      uri: `mongodb://127.0.0.1:${port}/unreachable_test`,
      logger: silentLogger,
      serverSelectionTimeoutMS: 500,
    })
    const error = await database.connect().catch((err) => err)
    expect(error).toBeInstanceOf(DatabaseConnectionError)
    expect(error.message).toMatch(/^Could not connect to MongoDB/)
    await expect(database.ping()).rejects.toThrow('not connected')
  })

  it('disconnect() is a no-op when never connected', async () => {
    database = createDatabase({
      uri: 'mongodb://127.0.0.1:1/never_test',
      logger: silentLogger,
    })
    await expect(database.disconnect()).resolves.toBeUndefined()
  })
})
