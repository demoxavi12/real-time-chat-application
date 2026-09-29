import { describe, expect, it } from 'vitest'
import { createLogger, redact } from '../../src/utils/logger.js'
import { createMemoryLogger } from '../helpers/testEnv.js'

describe('logger', () => {
  it('writes structured JSON lines with level, message and fields', () => {
    const { logger, lines } = createMemoryLogger('info')
    logger.info('hello', { requestId: 'abc' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      level: 'info',
      msg: 'hello',
      requestId: 'abc',
    })
    expect(Date.parse(lines[0].time)).not.toBeNaN()
  })

  it('drops entries below the configured level', () => {
    const { logger, lines } = createMemoryLogger('warn')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    expect(lines.map((line) => line.level)).toEqual(['warn', 'error'])
  })

  it('writes nothing when silent', () => {
    const { logger, lines } = createMemoryLogger('silent')
    logger.error('e')
    expect(lines).toEqual([])
  })

  it('redacts sensitive keys at any depth', () => {
    const { logger, lines } = createMemoryLogger('info')
    logger.info('request', {
      headers: { authorization: 'Bearer abc.def.ghi', cookie: 'sid=1' },
      user: { password: 'hunter2', name: 'Alice' },
      jwtToken: 'x',
      MONGODB_URI: 'mongodb://u:p@h/db', // secret-scan:allow (fake fixture)
      items: [{ apiKey: 'k' }],
    })
    const output = JSON.stringify(lines[0])
    for (const secret of ['abc.def.ghi', 'sid=1', 'hunter2', 'mongodb://u:p']) {
      expect(output).not.toContain(secret)
    }
    expect(lines[0].user.name).toBe('Alice')
    expect(lines[0].headers.authorization).toBe('[REDACTED]')
    expect(lines[0].items[0].apiKey).toBe('[REDACTED]')
  })

  it('redacts sensitive keys in child logger bindings', () => {
    const { logger, lines } = createMemoryLogger('info')
    logger.child({ token: 't0k3n', socketId: 's1' }).info('x')
    expect(lines[0]).toMatchObject({ token: '[REDACTED]', socketId: 's1' })
  })

  it('serializes errors', () => {
    const error = Object.assign(new Error('boom'), { code: 'E_BOOM' })
    expect(redact({ err: error }).err).toMatchObject({
      name: 'Error',
      message: 'boom',
      code: 'E_BOOM',
    })
  })

  it('rejects unknown levels', () => {
    expect(() => createLogger({ level: 'loud' })).toThrow('Unknown log level')
  })
})
