import { clientConfig } from '../../config/index.js'
import { createHttpClient } from './httpClient.js'
import { createSystemApi } from './systemApi.js'

export const httpClient = createHttpClient({ baseUrl: clientConfig.apiUrl })
export const systemApi = createSystemApi(httpClient)
