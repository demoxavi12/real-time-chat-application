export function createSystemApi(http) {
  return {
    getHealth: (options) => http.get('/health', options),
    getReadiness: (options) => http.get('/ready', options),
  }
}
