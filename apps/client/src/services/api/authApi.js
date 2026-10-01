/**
 * Authentication endpoints. The session lives in an HttpOnly cookie that the
 * browser sends automatically (credentials: 'include'); client code never
 * sees or stores the token.
 */
export function createAuthApi(http) {
  const user = (data) => data.user
  return {
    me: (options) => http.get('/auth/me', options).then(user),
    login: ({ email, password }) =>
      http
        .request('/auth/login', { method: 'POST', body: { email, password } })
        .then(user),
    register: ({ name, email, password }) =>
      http
        .request('/auth/register', {
          method: 'POST',
          body: { name, email, password },
        })
        .then(user),
    logout: () => http.request('/auth/logout', { method: 'POST' }),
  }
}
