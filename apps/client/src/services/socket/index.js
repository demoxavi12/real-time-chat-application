import { clientConfig } from '../../config/index.js'
import { createSocketClient } from './socketClient.js'

/** Creates the app's (not yet connected) Socket.IO client. */
export const createAppSocket = () =>
  createSocketClient({ url: clientConfig.socketUrl })
