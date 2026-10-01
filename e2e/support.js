import { randomUUID } from 'node:crypto'
import { request as playwrightRequest } from '@playwright/test'

/** Must match playwright.config.js (backend started by scripts/e2e-backend.js). */
export const API_ORIGIN = 'http://127.0.0.1:5100'

/**
 * A unique, obviously fake user per call. The `.test` TLD is reserved, and the
 * E2E database is ephemeral (destroyed after every run).
 */
export function uniqueUser(label = 'user') {
  const id = randomUUID().slice(0, 8)
  return {
    name: `E2E ${label} ${id}`,
    email: `e2e-${label}-${id}@example.test`,
    password: `e2e-passphrase-${randomUUID()}`,
  }
}

/** Creates a user directly through the API (test setup, not under test). */
export async function createUserViaApi(user) {
  const api = await playwrightRequest.newContext({ baseURL: API_ORIGIN })
  try {
    const res = await api.post('/api/auth/register', { data: user })
    if (res.status() !== 201) {
      throw new Error(`setup registration failed: ${res.status()}`)
    }
    return (await res.json()).data.user
  } finally {
    await api.dispose()
  }
}

export async function signInViaUi(page, { email, password }) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export function currentUser(page) {
  return page.getByTestId('current-user')
}

export async function sessionCookie(context) {
  const cookies = await context.cookies(API_ORIGIN)
  return cookies.find((cookie) => /^(__Host-)?rtc_session$/.test(cookie.name))
}
