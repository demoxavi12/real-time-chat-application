import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { errorHandler } from '../../src/middleware/errorHandler.js'
import { validate } from '../../src/middleware/validate.js'
import { AppError } from '../../src/utils/AppError.js'
import { createMemoryLogger } from '../helpers/testEnv.js'

function appWith(register) {
  const { logger, lines } = createMemoryLogger('error')
  const app = express()
  app.use(express.json())
  register(app)
  app.use(errorHandler(logger))
  return { app, lines }
}

describe('validate middleware', () => {
  const { app } = appWith((a) =>
    a.post(
      '/items/:id',
      validate({
        params: z.object({ id: z.string().regex(/^\d+$/) }),
        query: z.object({ limit: z.coerce.number().int().max(50).default(30) }),
        body: z.object({ name: z.string().min(1).max(20) }).strict(),
      }),
      (req, res) => res.json(req.validated),
    ),
  )

  it('passes parsed values to the handler', async () => {
    const res = await request(app)
      .post('/items/42?limit=10')
      .send({ name: 'ok' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      params: { id: '42' },
      query: { limit: 10 },
      body: { name: 'ok' },
    })
  })

  it('applies schema defaults', async () => {
    const res = await request(app).post('/items/1').send({ name: 'ok' })
    expect(res.body.query).toEqual({ limit: 30 })
  })

  it('rejects invalid input with a VALIDATION_ERROR envelope', async () => {
    const res = await request(app)
      .post('/items/abc?limit=500')
      .send({ name: '', extra: true })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.message).toBe('Invalid request')
    const paths = res.body.error.details.map((detail) => detail.path)
    expect(paths).toContain('params.id')
  })

  it('reports body issues with their location', async () => {
    const res = await request(app).post('/items/1').send({ name: 42 })
    expect(res.status).toBe(400)
    expect(res.body.error.details).toEqual([
      { path: 'body.name', message: expect.any(String) },
    ])
  })
})

describe('error handler', () => {
  it('maps AppError to its status and public fields', async () => {
    const { app, lines } = appWith((a) =>
      a.get('/x', () => {
        throw new AppError(403, 'FORBIDDEN', 'Not authorized')
      }),
    )
    const res = await request(app).get('/x')
    expect(res.status).toBe(403)
    expect(res.body).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Not authorized' },
    })
    expect(lines).toEqual([])
  })

  it('hides details of unexpected errors and logs them server-side', async () => {
    const { app, lines } = appWith((a) =>
      a.get('/x', async () => {
        throw new Error('secret internal detail: mongodb://u:p@db') // secret-scan:allow (fake fixture)
      }),
    )
    const res = await request(app).get('/x')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
    expect(JSON.stringify(res.body)).not.toMatch(/secret|stack|at /)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      level: 'error',
      msg: 'unhandled request error',
      path: '/x',
    })
  })
})
