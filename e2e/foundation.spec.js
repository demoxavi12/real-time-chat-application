import { expect, test } from '@playwright/test'

function statusValue(page, label) {
  return page
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]')
}

test.describe('foundation page', () => {
  test('loads the production bundle and shows a healthy full stack', async ({
    page,
  }) => {
    const consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    await page.goto('/')

    await expect(page).toHaveTitle('Real-Time Chat')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Real-Time Chat' }),
    ).toBeVisible()

    // These values come from real cross-origin calls to the backend, whose
    // readiness depends on a live MongoDB ping.
    await expect(statusValue(page, 'API')).toHaveText('Online')
    await expect(statusValue(page, 'Readiness')).toHaveText('Ready')
    await expect(statusValue(page, 'Database')).toHaveText('Up')

    expect(consoleErrors).toEqual([])
  })

  test('re-checks backend status on demand', async ({ page }) => {
    await page.goto('/')
    await expect(statusValue(page, 'Readiness')).toHaveText('Ready')

    const readyRequest = page.waitForRequest((request) =>
      request.url().endsWith('/api/ready'),
    )
    await page.getByRole('button', { name: 'Check again' }).click()
    await readyRequest
    await expect(statusValue(page, 'Readiness')).toHaveText('Ready')
  })

  test('layout fits the viewport without horizontal scrolling', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(statusValue(page, 'API')).toHaveText('Online')
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
