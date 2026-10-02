import { expect, test } from '@playwright/test'
import {
  conversationNav,
  createUserViaApi,
  showConversationList,
  signInViaUi,
  uniqueUser,
} from './support.js'

// Phase 4/5 user-experience flows. Every wait is an auto-retrying assertion
// on observable UI state; there are no fixed sleeps.

async function signedInPage(browser, user, contextOptions = {}) {
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()
  await signInViaUi(page, user)
  await expect(page.getByTestId('current-user')).toHaveText(user.name)
  await expect(page.getByTestId('connection-status')).toHaveText('Live')
  return { context, page }
}

const messageList = (page) => page.getByRole('list', { name: 'Messages' })
const messageText = (page, text) =>
  messageList(page).locator('.message-content', { hasText: text })
const composer = (page) => page.getByLabel('Message', { exact: true })

async function openPrivateWith(page, other) {
  await page.getByLabel('Name or email').fill(other.name)
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('button', { name: `Message ${other.name}` }).click()
  await expect(page).toHaveURL(/\/conversations\/[0-9a-f]{24}$/)
  await expect(page.getByRole('heading', { name: other.name })).toBeVisible()
  return page.url()
}

async function openPublicRoom(page) {
  await conversationNav(page).getByRole('link', { name: 'General' }).click()
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible()
}

async function horizontalOverflow(page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  )
}

test.describe('sending reliability', () => {
  test('a failed send keeps the draft and a retry delivers it exactly once', async ({
    browser,
  }) => {
    const alice = uniqueUser('offline')
    await createUserViaApi(alice)
    const { context, page } = await signedInPage(browser, alice)
    try {
      await openPublicRoom(page)
      const text = `offline draft ${alice.name}`

      await context.setOffline(true)
      await expect(page.getByTestId('connection-status')).not.toHaveText('Live')
      await composer(page).fill(text)
      await page.getByRole('button', { name: 'Send' }).click()
      await expect(page.locator('#message-error')).toHaveText(
        /Unable to reach the server/,
      )
      await expect(composer(page)).toHaveValue(text)
      await expect(messageText(page, text)).toHaveCount(0)

      await context.setOffline(false)
      await expect(page.getByTestId('connection-status')).toHaveText('Live')
      await page.getByRole('button', { name: 'Send' }).click()
      await expect(messageText(page, text)).toHaveCount(1)
      await expect(composer(page)).toHaveValue('')

      await page.reload()
      await expect(messageText(page, text)).toHaveCount(1)
    } finally {
      await context.close()
    }
  })

  test('rapid repeated sends store the message once', async ({ browser }) => {
    const alice = uniqueUser('double')
    await createUserViaApi(alice)
    const { context, page } = await signedInPage(browser, alice)
    try {
      await openPublicRoom(page)
      const text = `double send ${alice.name}`
      await composer(page).fill(text)
      await composer(page).press('Enter')
      await composer(page).press('Enter')
      await expect(messageText(page, text)).toHaveCount(1)
      await page.reload()
      await expect(messageText(page, text)).toHaveCount(1)
    } finally {
      await context.close()
    }
  })
})

test.describe('conversation state', () => {
  test('the list shows live previews and "Seen" survives a reload', async ({
    browser,
  }) => {
    const alice = uniqueUser('seen-a')
    const bob = uniqueUser('seen-b')
    await Promise.all([alice, bob].map(createUserViaApi))
    const a = await signedInPage(browser, alice)
    const b = await signedInPage(browser, bob)
    try {
      const url = await openPrivateWith(a.page, bob)
      const text = `preview check ${alice.name}`
      await composer(a.page).fill(text)
      await composer(a.page).press('Enter')
      await expect(messageText(a.page, text)).toHaveCount(1)
      await expect(a.page.getByText('Sent', { exact: true })).toBeVisible()

      // Bob, on the list, sees Alice's message as the live preview.
      const bobLink = conversationNav(b.page).getByRole('link', {
        name: alice.name,
      })
      await expect(bobLink).toHaveAccessibleDescription(
        new RegExp(`${alice.name}: ${text}`),
      )

      // Bob opens it (reading it); Alice sees "Seen", also after a reload.
      await bobLink.click()
      await expect(b.page).toHaveURL(url)
      await expect(messageText(b.page, text)).toHaveCount(1)
      await expect(a.page.getByText('Seen', { exact: true })).toBeVisible()
      await a.page.reload()
      await expect(a.page.getByText('Seen', { exact: true })).toBeVisible()
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('an ended session returns to sign in with an explanation', async ({
    browser,
  }) => {
    const alice = uniqueUser('expiry')
    await createUserViaApi(alice)
    const { context, page } = await signedInPage(browser, alice)
    try {
      await openPublicRoom(page)
      // The session cookie disappearing is what an expiry looks like to
      // the browser; the next API call is rejected with 401.
      await context.clearCookies()
      await page
        .getByRole('region', { name: 'General' })
        .getByRole('button', { name: 'Refresh' })
        .click()
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
      await expect(page.getByRole('status')).toHaveText(
        'Your session has ended. Please sign in again.',
      )
    } finally {
      await context.close()
    }
  })
})

test.describe('responsive layout', () => {
  test('narrow screens show one pane at a time with a back link', async ({
    browser,
  }) => {
    const alice = uniqueUser('narrow')
    await createUserViaApi(alice)
    const { context, page } = await signedInPage(browser, alice, {
      viewport: { width: 320, height: 640 },
      isMobile: true,
      hasTouch: true,
    })
    try {
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
      await openPublicRoom(page)
      await expect(conversationNav(page)).toBeHidden()
      await expect(composer(page)).toBeInViewport()
      await expect(page.getByRole('heading', { name: 'General' })).toBeFocused()
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)

      // A long unbroken message wraps instead of widening the page.
      const long = `${'x'.repeat(300)} ${alice.name}`
      await composer(page).fill(long)
      await page.getByRole('button', { name: 'Send' }).click()
      await expect(messageText(page, alice.name)).toHaveCount(1)
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)

      await showConversationList(page)
      await expect(page).toHaveURL(/\/$/)
      await expect(page.getByRole('heading', { name: 'General' })).toBeHidden()
    } finally {
      await context.close()
    }
  })

  test('large screens show the list and conversation side by side', async ({
    browser,
  }) => {
    const alice = uniqueUser('wide')
    await createUserViaApi(alice)
    const { context, page } = await signedInPage(browser, alice, {
      viewport: { width: 1920, height: 1080 },
    })
    try {
      await openPublicRoom(page)
      await expect(conversationNav(page)).toBeVisible()
      await expect(
        page.getByRole('link', { name: 'Back to conversations', exact: true }),
      ).toBeHidden()
      await expect(composer(page)).toBeInViewport()
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
    } finally {
      await context.close()
    }
  })
})
