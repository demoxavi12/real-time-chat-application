import { expect, request, test } from '@playwright/test'
import {
  API_ORIGIN,
  createUserViaApi,
  currentUser,
  sessionCookie,
  signInViaUi,
  uniqueUser,
} from './support.js'

test.describe('authentication', () => {
  test('registration creates an account and opens the app', async ({
    page,
    context,
  }) => {
    const user = uniqueUser('register')
    await page.goto('/register')
    await page.getByLabel('Name').fill(user.name)
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(user.password)
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(currentUser(page)).toHaveText(user.name)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

    // The session token is an HttpOnly cookie, invisible to page scripts and
    // never stored in Web Storage.
    const cookie = await sessionCookie(context)
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })
    const exposed = await page.evaluate(() => ({
      cookies: document.cookie,
      storage: JSON.stringify({ ...localStorage, ...sessionStorage }),
    }))
    expect(exposed.cookies).not.toContain('rtc_session')
    expect(exposed.storage).not.toContain(cookie.value)
  })

  test('login with valid credentials opens the app', async ({ page }) => {
    const user = uniqueUser('login')
    await createUserViaApi(user)

    await signInViaUi(page, user)

    await expect(currentUser(page)).toHaveText(user.name)
    await expect(page.getByText(`(${user.email})`)).toBeVisible()
  })

  test('invalid login shows an error and stays signed out', async ({
    page,
    context,
  }) => {
    const user = uniqueUser('invalid')
    await createUserViaApi(user)

    await signInViaUi(page, { email: user.email, password: 'wrong-password' })

    await expect(page.getByRole('alert')).toHaveText(
      'Email or password is incorrect.',
    )
    await expect(page).toHaveURL(/\/login$/)
    expect(await sessionCookie(context)).toBeUndefined()

    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(currentUser(page)).toHaveCount(0)
  })

  test('the session survives a page reload', async ({ page }) => {
    const user = uniqueUser('refresh')
    await createUserViaApi(user)
    await signInViaUi(page, user)
    await expect(currentUser(page)).toHaveText(user.name)

    await page.reload()

    await expect(currentUser(page)).toHaveText(user.name)
    await expect(page).toHaveURL(/\/$/)
  })

  test('logout ends the session everywhere it was used', async ({
    page,
    context,
  }) => {
    const user = uniqueUser('logout')
    await createUserViaApi(user)
    await signInViaUi(page, user)
    await expect(currentUser(page)).toHaveText(user.name)
    const { value: oldToken } = await sessionCookie(context)

    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
    expect(await sessionCookie(context)).toBeUndefined()

    // The protected app is no longer reachable, even via history.
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.goBack()
    await expect(currentUser(page)).toHaveCount(0)

    // The server revoked the session: replaying the old token fails.
    const replay = await request.newContext({ baseURL: API_ORIGIN })
    const res = await replay.get('/api/auth/me', {
      headers: { Cookie: `rtc_session=${oldToken}` },
    })
    expect(res.status()).toBe(401)
    await replay.dispose()
  })

  test('protected routes redirect to login and back after signing in', async ({
    page,
  }) => {
    const user = uniqueUser('guard')
    await createUserViaApi(user)

    await page.goto('/?view=home')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(user.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(currentUser(page)).toHaveText(user.name)
    await expect(page).toHaveURL(/\/\?view=home$/)

    // Signed-in users are sent away from the guest pages.
    await page.goto('/login')
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/register')
    await expect(page).toHaveURL(/\/$/)
  })

  test('users are isolated: A can never see or become B', async ({
    browser,
  }) => {
    const alice = uniqueUser('alice')
    const bob = uniqueUser('bob')
    const bobRecord = await createUserViaApi(bob)
    await createUserViaApi(alice)

    const aliceContext = await browser.newContext()
    const bobContext = await browser.newContext()
    try {
      const alicePage = await aliceContext.newPage()
      const bobPage = await bobContext.newPage()
      await signInViaUi(alicePage, alice)
      await signInViaUi(bobPage, bob)
      await expect(currentUser(alicePage)).toHaveText(alice.name)
      await expect(currentUser(bobPage)).toHaveText(bob.name)
      await expect(alicePage.getByText(bob.email)).toHaveCount(0)

      // Asking for Bob by id with Alice's session still returns Alice.
      const forged = await alicePage.request.get(
        `${API_ORIGIN}/api/auth/me?userId=${bobRecord.id}`,
        { headers: { 'X-User-Id': bobRecord.id } },
      )
      expect(forged.status()).toBe(200)
      expect((await forged.json()).data.user.email).toBe(alice.email)

      // Alice signing out does not touch Bob's session.
      await alicePage.getByRole('button', { name: 'Sign out' }).click()
      await expect(alicePage).toHaveURL(/\/login$/)
      await bobPage.reload()
      await expect(currentUser(bobPage)).toHaveText(bob.name)
    } finally {
      await aliceContext.close()
      await bobContext.close()
    }
  })

  test('login and register pages fit the viewport', async ({ page }) => {
    for (const route of ['/login', '/register']) {
      await page.goto(route)
      await expect(page.getByRole('button').first()).toBeVisible()
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    }
  })
})
