import { clientConfig } from '../../config/index.js'
import { createAuthApi } from './authApi.js'
import { createChatApi } from './chatApi.js'
import { createHttpClient } from './httpClient.js'
import { createSystemApi } from './systemApi.js'

export const httpClient = createHttpClient({ baseUrl: clientConfig.apiUrl })
export const systemApi = createSystemApi(httpClient)
export const authApi = createAuthApi(httpClient)
export const chatApi = createChatApi(httpClient)
