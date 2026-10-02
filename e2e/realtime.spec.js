import { expect, test } from '@playwright/test'
import {
  API_ORIGIN,
  createUserViaApi,
  signInViaUi,
  uniqueUser,
} from './support.js'

// All waits below are on observable UI state (Playwright auto-retrying
// assertions); there are no fixed sleeps.

async function signedInPage(browser, user) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInViaUi(page, user)
  await expect(page.getByTestId('current-user')).toHaveText(user.name)
  await expect(page.getByTestId('connection-status')).toHaveText('Live')
  return { context, page }
}

const conversations = (page) =>
  page.getByRole('navigation', { name: 'Conversations' })
const messageList = (page) => page.getByRole('list', { name: 'Messages' })
const messageText = (page, text) =>
  messageList(page).locator('.message-content', { hasText: text })

async function openPrivateWith(page, other) {
  await page.getByLabel('Name or email').fill(other.name)
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('button', { name: `Message ${other.name}` }).click()
  await expect(page).toHaveURL(/\/conversations\/[0-9a-f]{24}$/)
  await expect(page.getByRole('heading', { name: other.name })).toBeVisible()
  return page.url()
}

async function send(page, text) {
  await page.getByLabel('Message', { exact: true }).fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(messageText(page, text)).toHaveCount(1)
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('')
}

test.describe('real-time messaging', () => {
  test('two users chat live: delivery, typing, read receipts, presence, durability, isolation', async ({
    browser,
  }) => {
    const alice = uniqueUser('rt-alice')
    const bob = uniqueUser('rt-bob')
    const carol = uniqueUser('rt-carol')
    await Promise.all([alice, bob, carol].map(createUserViaApi))

    const a = await signedInPage(browser, alice)
    const b = await signedInPage(browser, bob)
    try {
      const conversationUrl = await openPrivateWith(a.page, bob)

      // Bob's list shows the new conversation live (conversation:update).
      const bobLink = conversations(b.page).getByRole('link', {
        name: new RegExp(alice.name),
      })
      await expect(bobLink).toBeVisible()
      await bobLink.click()
      await expect(b.page).toHaveURL(conversationUrl)

      // Presence: each sees the other online.
      await expect(a.page.getByTestId('conversation-presence')).toHaveText(
        'Online',
      )
      await expect(b.page.getByTestId('conversation-presence')).toHaveText(
        'Online',
      )

      // Typing indicator.
      await b.page.getByLabel('Message', { exact: true }).fill('typing…')
      await expect(a.page.getByText(`${bob.name} is typing…`)).toBeVisible()
      await b.page.getByLabel('Message', { exact: true }).fill('')
      await expect(a.page.getByText(`${bob.name} is typing…`)).toHaveCount(0)

      // Alice -> Bob without refresh, exactly once on both sides.
      await send(a.page, 'Hello Bob, live!')
      await expect(messageText(b.page, 'Hello Bob, live!')).toHaveCount(1)

      // Bob has now seen it.
      await expect(a.page.getByText('Seen')).toBeVisible()

      // Bob -> Alice without refresh.
      await send(b.page, 'Hi Alice, got it live.')
      await expect(messageText(a.page, 'Hi Alice, got it live.')).toHaveCount(1)
      await expect(messageText(a.page, 'Hello Bob, live!')).toHaveCount(1)

      // Durable: a reload shows both, in order, once.
      await b.page.reload()
      await expect(messageList(b.page).locator('.message-content')).toHaveText([
        'Hello Bob, live!',
        'Hi Alice, got it live.',
      ])

      // Carol cannot open the conversation or read it via the API.
      const c = await signedInPage(browser, carol)
      try {
        await c.page.goto(conversationUrl)
        await expect(
          c.page.getByRole('heading', { name: 'Conversation not found' }),
        ).toBeVisible()
        const conversationId = conversationUrl.split('/').pop()
        const res = await c.page.request.get(
          `${API_ORIGIN}/api/conversations/${conversationId}/messages`,
        )
        expect(res.status()).toBe(404)
        await expect(c.page.getByText('Hello Bob, live!')).toHaveCount(0)
      } finally {
        await c.context.close()
      }

      // Presence: Bob leaving makes him offline for Alice.
      await b.context.close()
      await expect(a.page.getByTestId('conversation-presence')).toHaveText(
        'Offline',
      )
    } finally {
      await a.context.close()
      await b.context.close().catch(() => {})
    }
  })

  test('multiple tabs of the same user stay in sync without duplicates', async ({
    browser,
  }) => {
    const alice = uniqueUser('tabs-a')
    const bob = uniqueUser('tabs-b')
    await Promise.all([alice, bob].map(createUserViaApi))
    const { context, page: tab1 } = await signedInPage(browser, alice)
    try {
      const conversationUrl = await openPrivateWith(tab1, bob)
      const tab2 = await context.newPage()
      await tab2.goto(conversationUrl)
      await expect(tab2.getByTestId('connection-status')).toHaveText('Live')
      await expect(tab2.getByText('No messages yet. Say hello!')).toBeVisible()

      await send(tab1, 'from tab one')
      await expect(messageText(tab2, 'from tab one')).toHaveCount(1)
      await send(tab2, 'from tab two')
      await expect(messageText(tab1, 'from tab two')).toHaveCount(1)
      await expect(messageText(tab1, 'from tab one')).toHaveCount(1)

      // Closing one tab leaves the other fully working.
      await tab1.close()
      await send(tab2, 'tab two alone')
      await tab2.reload()
      await expect(messageList(tab2).locator('.message-content')).toHaveText([
        'from tab one',
        'from tab two',
        'tab two alone',
      ])
    } finally {
      await context.close()
    }
  })

  test('a client that was offline reconnects and recovers missed messages', async ({
    browser,
  }) => {
    const alice = uniqueUser('net-a')
    const bob = uniqueUser('net-b')
    await Promise.all([alice, bob].map(createUserViaApi))
    const a = await signedInPage(browser, alice)
    const b = await signedInPage(browser, bob)
    try {
      const conversationUrl = await openPrivateWith(a.page, bob)
      await b.page.goto(conversationUrl)
      await expect(b.page.getByTestId('connection-status')).toHaveText('Live')

      await b.context.setOffline(true)
      await expect(b.page.getByTestId('connection-status')).not.toHaveText(
        'Live',
      )

      await send(a.page, 'sent while bob was offline')

      await b.context.setOffline(false)
      await expect(b.page.getByTestId('connection-status')).toHaveText('Live', {
        timeout: 30_000,
      })
      await expect(
        messageText(b.page, 'sent while bob was offline'),
      ).toHaveCount(1)

      // And live delivery works again after the reconnect.
      await send(a.page, 'and live again')
      await expect(messageText(b.page, 'and live again')).toHaveCount(1)
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('the public room is live for everyone', async ({ browser }) => {
    const alice = uniqueUser('pub-rt-a')
    const bob = uniqueUser('pub-rt-b')
    await Promise.all([alice, bob].map(createUserViaApi))
    const a = await signedInPage(browser, alice)
    const b = await signedInPage(browser, bob)
    try {
      for (const { page } of [a, b]) {
        await conversations(page)
          .getByRole('link', { name: /General/ })
          .click()
        await expect(
          page.getByRole('heading', { name: 'General' }),
        ).toBeVisible()
      }
      const text = `Live hello from ${alice.name}`
      await send(a.page, text)
      await expect(messageText(b.page, text)).toHaveCount(1)
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('signing out in one tab disconnects the other tab of that session', async ({
    browser,
  }) => {
    const alice = uniqueUser('logout-rt')
    await createUserViaApi(alice)
    const { context, page: tab1 } = await signedInPage(browser, alice)
    try {
      const tab2 = await context.newPage()
      await tab2.goto('/')
      await expect(tab2.getByTestId('connection-status')).toHaveText('Live')

      await tab1.getByRole('button', { name: 'Sign out' }).click()
      await expect(tab1).toHaveURL(/\/login$/)
      // The server closed tab 2's socket; it re-checked the session.
      await expect(tab2).toHaveURL(/\/login$/)
      await expect(tab2.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    } finally {
      await context.close()
    }
  })
})
