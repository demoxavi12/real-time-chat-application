import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { TEST_ORIGIN, uniqueDbName, withDatabase } from '../helpers/testEnv.js'

// Startup smoke tests: run the real entry point as a child process, exactly
// as `npm start` would, instead of checking by hand that the backend boots.
const entry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/index.js',
)

const children = []

function run(env) {
  const child = spawn(process.execPath, [entry], {
    // Only pass what the test controls; never inherit a developer's .env/DB.
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = { stdout: '', stderr: '' }
  child.stdout.on('data', (chunk) => (output.stdout += chunk))
  child.stderr.on('data', (chunk) => (output.stderr += chunk))
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  )
  children.push(child)
  return { child, output, exited }
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForReady(url, exited, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let processExited = false
  exited.then(() => (processExited = true))
  while (Date.now() < deadline && !processExited) {
    try {
      const res = await fetch(url)
      if (res.status === 200) return res
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`server did not become ready at ${url}`)
}

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill('SIGKILL')
  }
})

describe('server process', () => {
  it('boots from the entry point and becomes ready', async () => {
    const port = await freePort()
    const { output, exited } = run({
      NODE_ENV: 'test',
      PORT: String(port),
      LOG_LEVEL: 'info',
      MONGODB_URI: withDatabase(inject('mongoUri'), uniqueDbName('proc')),
      CLIENT_ORIGIN: TEST_ORIGIN,
    })

    const res = await waitForReady(`http://127.0.0.1:${port}/ready`, exited)
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { status: 'ready' },
    })

    const logs = output.stdout
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(logs.map((l) => l.msg)).toEqual(
      expect.arrayContaining(['database connected', 'server listening']),
    )
    // Logs must never contain the connection string.
    expect(output.stdout).not.toContain('mongodb://')
  })

  // POSIX signals cannot be delivered to a child process on Windows (kill()
  // terminates it immediately), so graceful signal handling runs on Linux CI.
  // The in-process close() path is covered on every platform in server.test.js.
  it.skipIf(process.platform === 'win32')(
    'shuts down gracefully on SIGTERM with exit code 0',
    async () => {
      const port = await freePort()
      const { child, output, exited } = run({
        NODE_ENV: 'test',
        PORT: String(port),
        LOG_LEVEL: 'info',
        MONGODB_URI: withDatabase(inject('mongoUri'), uniqueDbName('proc')),
        CLIENT_ORIGIN: TEST_ORIGIN,
      })
      await waitForReady(`http://127.0.0.1:${port}/ready`, exited)

      child.kill('SIGTERM')
      await expect(exited).resolves.toEqual({ code: 0, signal: null })
      expect(output.stdout).toContain('shutdown complete')
    },
  )

  it('exits with code 1 and a clear message when configuration is missing', async () => {
    const { output, exited } = run({ NODE_ENV: 'test' })
    await expect(exited).resolves.toEqual({ code: 1, signal: null })
    expect(output.stderr).toContain('Invalid environment configuration')
    expect(output.stderr).toContain('MONGODB_URI: is required')
    expect(output.stderr).toContain('CLIENT_ORIGIN: is required')
  })

  it('refuses a non-local database under NODE_ENV=test', async () => {
    const { output, exited } = run({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://user:hunter2@prod.example.net/chat', // secret-scan:allow (fake fixture)
      CLIENT_ORIGIN: TEST_ORIGIN,
    })
    await expect(exited).resolves.toEqual({ code: 1, signal: null })
    expect(output.stderr).toContain('must point at a loopback host')
    expect(output.stderr).not.toContain('hunter2')
  })

  it('exits with code 1 when MongoDB is unreachable', async () => {
    const port = await freePort()
    const { output, exited } = run({
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      MONGODB_URI: `mongodb://127.0.0.1:${port}/unreachable_test`,
      CLIENT_ORIGIN: TEST_ORIGIN,
    })
    await expect(exited).resolves.toEqual({ code: 1, signal: null })
    expect(output.stdout).toContain('startup failed')
    expect(output.stdout).toContain('Could not connect to MongoDB')
  })
})
