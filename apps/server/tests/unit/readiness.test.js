import { describe, expect, it } from 'vitest'
import { createReadinessService } from '../../src/services/readiness.service.js'

describe('readiness service', () => {
  it('is ready when every check resolves', async () => {
    const service = createReadinessService({
      database: async () => {},
      other: () => undefined,
    })
    await expect(service.check()).resolves.toEqual({
      ready: true,
      checks: { database: 'up', other: 'up' },
    })
  })

  it('reports the failing dependency when a check rejects', async () => {
    const service = createReadinessService({
      database: async () => {
        throw new Error('down')
      },
      other: async () => {},
    })
    await expect(service.check()).resolves.toEqual({
      ready: false,
      checks: { database: 'down', other: 'up' },
    })
  })

  it('treats a synchronously throwing check as down', async () => {
    const service = createReadinessService({
      database: () => {
        throw new Error('sync failure')
      },
    })
    await expect(service.check()).resolves.toMatchObject({ ready: false })
  })

  it('treats a check that exceeds the timeout as down', async () => {
    const service = createReadinessService(
      { database: () => new Promise(() => {}) },
      { timeoutMs: 20 },
    )
    await expect(service.check()).resolves.toEqual({
      ready: false,
      checks: { database: 'down' },
    })
  })
})
