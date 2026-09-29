import net from 'node:net'
import { MongoMemoryServer } from 'mongodb-memory-server'
import request from 'supertest'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { startServer } from '../../src/server.js'
import {
  silentLogger,
  testConfig,
  uniqueDbName,
  withDatabase,
} from '../helpers/testEnv.js'

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

describe('server lifecycle', () => {
  let server

  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  it('serves /health and a truthful /ready backed by MongoDB', async () => {
    server = await startServer({
      config: testConfig({
        MONGODB_URI: withDatabase(inject('mongoUri'), uniqueDbName('srv')),
      }),
      logger: silentLogger,
    })
    const base = `http://127.0.0.1:${server.port}`

    await request(base).get('/health').expect(200)
    const ready = await request(base).get('/ready')
    expect(ready.status).toBe(200)
    expect(ready.body.data).toEqual({
      status: 'ready',
      checks: { database: 'up' },
    })
    await request(base).get('/api/ready').expect(200)
  })

  it('reports not ready once MongoDB goes away, while staying live', async () => {
    // Dedicated instance so stopping it cannot affect other test files.
    const mongo = await MongoMemoryServer.create({
      instance: { ip: '127.0.0.1' },
    })
    try {
      server = await startServer({
        config: testConfig({ MONGODB_URI: mongo.getUri('outage_test') }),
        logger: silentLogger,
      })
      const base = `http://127.0.0.1:${server.port}`
      await request(base).get('/ready').expect(200)

      await mongo.stop({ doCleanup: false })

      const ready = await request(base).get('/ready')
      expect(ready.status).toBe(503)
      expect(ready.body.error).toEqual({
        code: 'NOT_READY',
        message: 'Service is not ready',
        details: [{ check: 'database', status: 'down' }],
      })
      await request(base).get('/health').expect(200)
    } finally {
      await server?.close()
      server = undefined
      await mongo.stop({ doCleanup: true, force: true })
    }
  })

  it('close() stops accepting connections and closes the database', async () => {
    server = await startServer({
      config: testConfig({
        MONGODB_URI: withDatabase(inject('mongoUri'), uniqueDbName('srv')),
      }),
      logger: silentLogger,
    })
    const { port, database } = server
    const connection = database.connection
    expect(await canConnect(port)).toBe(true)

    await Promise.all([server.close(), server.close()])

    expect(await canConnect(port)).toBe(false)
    expect(connection.readyState).toBe(0)
    server = undefined
  })

  it('fails to start and releases the database when the port is taken', async () => {
    const blocker = net.createServer()
    await new Promise((resolve) => blocker.listen(0, resolve))
    const { port } = blocker.address()
    try {
      const error = await startServer({
        config: testConfig({
          PORT: String(port),
          MONGODB_URI: withDatabase(inject('mongoUri'), uniqueDbName('srv')),
        }),
        logger: silentLogger,
      }).catch((err) => err)
      expect(error.code).toBe('EADDRINUSE')
    } finally {
      await new Promise((resolve) => blocker.close(resolve))
    }
  })
})
