import { expect, test } from '@playwright/test'
import {
  API_ORIGIN,
  createUserViaApi,
  signInViaUi,
  uniqueUser,
} from './support.js'

async function signedInPage(browser, user) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInViaUi(page, user)
  await expect(page.getByTestId('current-user')).toHaveText(user.name)
  return { context, page }
}

const conversations = (page) =>
  page.getByRole('navigation', { name: 'Conversations' })
const messageList = (page) => page.getByRole('list', { name: 'Messages' })

async function sendMessage(page, text) {
  await page.getByLabel('Message', { exact: true }).fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(messageList(page).getByText(text, { exact: true })).toBeVisible()
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('')
}

// Phase 2 durable flows (REST). Live delivery is covered by realtime.spec.js.
test.describe('conversations and messages (durable REST flows)', () => {
  test('two users discover each other, chat privately, and a third user is kept out', async ({
    browser,
  }) => {
    const alice = uniqueUser('alice')
    const bob = uniqueUser('bob')
    const carol = uniqueUser('carol')
    await Promise.all([alice, bob, carol].map(createUserViaApi))

    // Alice finds Bob and starts a private conversation.
    const a = await signedInPage(browser, alice)
    try {
      await a.page.getByLabel('Name or email').fill(bob.name)
      await a.page.getByRole('button', { name: 'Search' }).click()
      await a.page.getByRole('button', { name: `Message ${bob.name}` }).click()
      await expect(a.page).toHaveURL(/\/conversations\/[0-9a-f]{24}$/)
      const conversationUrl = a.page.url()
      await expect(
        a.page.getByRole('heading', { name: bob.name }),
      ).toBeVisible()
      await expect(
        a.page.getByText('No messages yet. Say hello!'),
      ).toBeVisible()

      await sendMessage(a.page, 'Hi Bob, this is Alice.')
      await expect(
        conversations(a.page).getByRole('link', { name: new RegExp(bob.name) }),
      ).toBeVisible()

      // Bob sees the conversation and the message, and replies.
      const b = await signedInPage(browser, bob)
      try {
        await conversations(b.page)
          .getByRole('link', { name: new RegExp(alice.name) })
          .click()
        await expect(b.page).toHaveURL(conversationUrl)
        await expect(
          messageList(b.page).getByText('Hi Bob, this is Alice.'),
        ).toBeVisible()
        await sendMessage(b.page, 'Hello Alice!')
      } finally {
        await b.context.close()
      }

      // Alice also gets the reply via an explicit Refresh (REST resync)...
      await a.page
        .getByRole('region', { name: bob.name })
        .getByRole('button', { name: 'Refresh' })
        .click()
      await expect(messageList(a.page).getByText('Hello Alice!')).toBeVisible()

      // ...and the history survives a full reload, in order.
      await a.page.reload()
      await expect(messageList(a.page).locator('.message-content')).toHaveText([
        'Hi Bob, this is Alice.',
        'Hello Alice!',
      ])

      // Opening the conversation again reuses it (no duplicate).
      await a.page.goto('/')
      await a.page.getByLabel('Name or email').fill(bob.email)
      await a.page.getByRole('button', { name: 'Search' }).click()
      await a.page.getByRole('button', { name: `Message ${bob.name}` }).click()
      await expect(a.page).toHaveURL(conversationUrl)
      await expect(
        conversations(a.page).getByRole('link', { name: new RegExp(bob.name) }),
      ).toHaveCount(1)

      // Carol cannot see or reach the conversation.
      const c = await signedInPage(browser, carol)
      try {
        await expect(
          conversations(c.page).getByRole('link', {
            name: new RegExp(alice.name),
          }),
        ).toHaveCount(0)
        await c.page.goto(conversationUrl)
        await expect(
          c.page.getByRole('heading', { name: 'Conversation not found' }),
        ).toBeVisible()
        await expect(c.page.getByText('Hi Bob, this is Alice.')).toHaveCount(0)

        const conversationId = conversationUrl.split('/').pop()
        const api = await c.page.request.get(
          `${API_ORIGIN}/api/conversations/${conversationId}/messages`,
        )
        expect(api.status()).toBe(404)
        expect(await api.text()).not.toContain('Hi Bob')
      } finally {
        await c.context.close()
      }
    } finally {
      await a.context.close()
    }
  })

  test('everyone can use the public room', async ({ browser }) => {
    const alice = uniqueUser('pub-a')
    const bob = uniqueUser('pub-b')
    await Promise.all([alice, bob].map(createUserViaApi))
    const text = `Hello General from ${alice.name}`

    const a = await signedInPage(browser, alice)
    const b = await signedInPage(browser, bob)
    try {
      await conversations(a.page)
        .getByRole('link', { name: /General/ })
        .click()
      await expect(
        a.page.getByRole('heading', { name: 'General' }),
      ).toBeVisible()
      await sendMessage(a.page, text)

      await conversations(b.page)
        .getByRole('link', { name: /General/ })
        .click()
      await expect(messageList(b.page).getByText(text)).toBeVisible()
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('message text is shown literally, never as HTML', async ({
    browser,
  }) => {
    const alice = uniqueUser('xss')
    await createUserViaApi(alice)
    const { context, page } = await signedInPage(browser, alice)
    try {
      let dialogOpened = false
      page.on('dialog', async (dialog) => {
        dialogOpened = true
        await dialog.dismiss()
      })
      await conversations(page)
        .getByRole('link', { name: /General/ })
        .click()
      const payload = `<img src=x onerror="alert('xss')"> ${alice.name}`
      await sendMessage(page, payload)
      await page.reload()
      await expect(messageList(page).getByText(payload)).toBeVisible()
      await expect(messageList(page).locator('img')).toHaveCount(0)
      expect(dialogOpened).toBe(false)
    } finally {
      await context.close()
    }
  })

  test('the chat layout fits the viewport', async ({ browser }) => {
    const alice = uniqueUser('layout')
    await createUserViaApi(alice)
    const { context, page } = await signedInPage(browser, alice)
    try {
      await conversations(page)
        .getByRole('link', { name: /General/ })
        .click()
      await expect(page.getByLabel('Message', { exact: true })).toBeVisible()
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    } finally {
      await context.close()
    }
  })
})
