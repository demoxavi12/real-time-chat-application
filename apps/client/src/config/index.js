import { resolveClientConfig } from './env.js'

export const clientConfig = resolveClientConfig(import.meta.env)
