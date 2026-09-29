import { MongoMemoryServer } from 'mongodb-memory-server'

/**
 * Test database lifecycle: start an isolated mongod bound to 127.0.0.1 with
 * in-memory-backed temporary storage, expose its URI to test files via
 * `inject('mongoUri')`, and stop + delete it when the run ends.
 */
export default async function setup({ provide }) {
  const mongo = await MongoMemoryServer.create({
    instance: { ip: '127.0.0.1' },
  })
  provide('mongoUri', mongo.getUri())
  return async () => {
    await mongo.stop({ doCleanup: true, force: true })
  }
}
