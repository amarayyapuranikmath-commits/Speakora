import { expect, test, type Page } from '@playwright/test'
import { PASSWORD, completeOnboarding, connectedPair, emailedToken, openHistory, openSettings, signOut, signUpWithEmail, sql, verifyByEmailedLink } from './helpers'

/**
 * Drives every remaining user-facing flow through the real UI against the real backend, PostgreSQL and Redis:
 * email verification, change/forgot/reset password, sign out and in, profile + privacy + notification settings,
 * topics, feedback, report, block/unblock, account deletion, and the admin moderation screen suspending a real user.
 * Reads emailed links from the backend log (no SMTP in development).
 */

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('account lifecycle: verify email, change password, sign out/in, forgot + reset password, delete account', async ({ browser }) => {
  const { page, email } = await signUpWithEmail(browser, 'Tour', { verify: false })

  // Signing up is finished only after the emailed code: the code screen is all that opens, and it says where the code went.
  await expect(page.getByRole('heading', { name: /verify your email/i })).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()
  // A new code can be asked for straight away: it is sent at once, and the message names the address and says that earlier codes stop working.
  await page.getByRole('button', { name: 'Send a new code' }).click()
  await expect(page.getByText(`A new code was sent to ${email}`)).toBeVisible()
  await expect(page.getByText(/Earlier codes no longer work/)).toBeVisible()
  await page.goto('/app')
  await expect(page).toHaveURL(/\/verify-email/)
  // The emailed link also finishes it; the account then carries on into onboarding and the dashboard.
  await verifyByEmailedLink(page, email)
  await completeOnboarding(page, 'Tour')
  // The dashboard carries no verification, resend or password prompts.
  await expect(page.getByText(/verify your email|resend|forgot password|one-time/i)).toHaveCount(0)

  // Change password in Settings
  await openSettings(page)
  await page.getByRole('tab', { name: 'Account' }).click()
  await page.getByLabel('Current password').fill('wrong-password-1')
  await page.getByLabel('New password').fill('SecondPass99')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('alert')).toContainText('current password is incorrect')
  await page.getByLabel('Current password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Password changed.')).toBeVisible()

  // Sign out, then the old password no longer works and the new one does
  await signOut(page)
  await expect(page).toHaveURL(/\/$/)
  await signIn(page, email, PASSWORD)
  await expect(page.getByRole('alert')).toContainText('Incorrect email or password')
  await signIn(page, email, 'SecondPass99')
  await expect(page.getByRole('heading', { name: /welcome back, tour/i })).toBeVisible()

  // Forgot password -> emailed link -> reset -> sign in with the reset password
  await signOut(page)
  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset code' }).click()
  await expect(page.getByText(/reset link are on their way/i)).toBeVisible()
  await expect.poll(() => emailedToken(email, 'reset-password')).not.toBeNull()
  await page.goto(`/reset-password?token=${emailedToken(email, 'reset-password')}`)
  await page.getByLabel('New password').fill('ThirdPass777')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText(/your password has been changed/i)).toBeVisible()
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('ThirdPass777')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /welcome back, tour/i })).toBeVisible()

  // The reset link cannot be used twice
  await page.goto(`/reset-password?token=${emailedToken(email, 'reset-password')}`)
  await page.getByLabel('New password').fill('FourthPass111')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('alert')).toContainText(/invalid or has expired/i)

  // Delete the account: needs the right password, then everything is gone
  await page.goto('/app/settings')
  await page.getByRole('tab', { name: 'Account' }).click()
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await page.getByLabel('Password', { exact: true }).fill('not-my-password')
  await page.getByRole('button', { name: 'Permanently delete' }).click()
  await expect(page.getByRole('alert')).toContainText('password is incorrect')
  await page.getByLabel('Password', { exact: true }).fill('ThirdPass777')
  await page.getByRole('button', { name: 'Permanently delete' }).click()
  await expect(page).toHaveURL(/\/$/)
  await signIn(page, email, 'ThirdPass777')
  await expect(page.getByRole('alert')).toContainText('Incorrect email or password')
})

test('settings persist after reload: profile, privacy, notifications; topics link to the right call setup', async ({ browser }) => {
  const { page } = await signUpWithEmail(browser, 'Tour')
  await openSettings(page)

  // Profile
  const name = page.getByLabel('Display name')
  await name.fill('Tour Renamed')
  await page.getByLabel('English level').selectOption('C1')
  await page.getByRole('group', { name: /learning goals/i }).getByRole('button', { name: 'Build confidence' }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Profile saved.')).toBeVisible()

  // Privacy + notifications
  await page.getByRole('tab', { name: 'Privacy' }).click()
  const country = page.getByRole('switch', { name: 'Show my country' })
  await expect(country).toBeChecked()
  await country.click()
  await expect(country).not.toBeChecked()
  await page.getByRole('tab', { name: 'Notifications' }).click()
  await expect(page.getByRole('switch', { name: 'Product updates' })).toHaveCount(0)
  const reminders = page.getByRole('switch', { name: 'Practice reminders' })
  await reminders.click()
  await expect(reminders).toBeChecked()
  await page.waitForTimeout(800) // let the optimistic update reach the server

  await page.reload()
  await expect(page.getByLabel('Display name')).toHaveValue('Tour Renamed')
  await expect(page.getByLabel('English level')).toHaveValue('C1')
  await expect(page.getByRole('group', { name: /learning goals/i }).getByRole('button', { name: 'Build confidence' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('tab', { name: 'Privacy' }).click()
  await expect(page.getByRole('switch', { name: 'Show my country' })).not.toBeChecked()
  await page.getByRole('tab', { name: 'Notifications' }).click()
  await expect(page.getByRole('switch', { name: 'Practice reminders' })).toBeChecked()
  await page.getByRole('link', { name: 'Home' }).first().click()
  await expect(page.getByRole('heading', { name: /welcome back, tour renamed/i })).toBeVisible() // header name updated

  // Topics -> practise a topic -> the call setup has it selected
  await page.goto('/app/topics')
  await page.getByRole('listitem').filter({ hasText: 'Travel' }).getByRole('link', { name: 'Practise this topic' }).click()
  await expect(page).toHaveURL(/\/app\/talk\?topic=travel/)
  await expect(page.getByRole('radio', { name: /Travel/ })).toBeChecked()

  // Empty states with working links
  await openHistory(page)
  await expect(page.getByText('No conversations yet')).toBeVisible()
  await page.getByRole('link', { name: 'Find a partner' }).click()
  await expect(page).toHaveURL(/\/app\/talk/)
  await page.getByRole('link', { name: 'Progress' }).first().click()
  await expect(page.getByText('Nothing to show yet')).toBeVisible()
})

test.describe('after a real call', () => {
  test.setTimeout(150_000)

  test('feedback from history, report + block from the call screen, unblock in settings', async ({ browser }) => {
    const { alice, bob } = await connectedPair(browser)
    await alice.getByRole('button', { name: 'End call' }).click()
    await expect(alice.getByRole('heading', { name: 'Call ended' })).toBeVisible()
    await expect(bob.getByRole('heading', { name: 'Call ended' })).toBeVisible()

    // Alice reports Bob (and blocks him) from the call-ended screen
    await alice.getByRole('button', { name: 'Report' }).click()
    await alice.getByLabel('Details (optional)').fill('Playwright test report')
    await alice.getByRole('button', { name: 'Send report' }).click()
    await expect(alice.getByText(/report sent and partner blocked/i)).toBeVisible()

    // Bob leaves feedback later, from History
    await bob.getByRole('link', { name: 'Back to dashboard' }).click()
    await openHistory(bob)
    const row = bob.getByRole('listitem').filter({ hasText: 'Alice' })
    await row.getByRole('button', { name: 'Leave feedback' }).click()
    const dialog = bob.getByRole('dialog')
    await dialog.getByRole('radio', { name: '4 out of 5' }).click()
    await dialog.getByRole('button', { name: 'Submit feedback' }).click()
    await expect(dialog.getByText(/feedback has been saved/i)).toBeVisible()
    await expect(bob.getByRole('dialog')).toHaveCount(0, { timeout: 5000 })
    await expect(row).toContainText('Feedback sent')

    // Alice sees Bob in her blocked list and can unblock him
    await alice.getByRole('link', { name: 'Back to dashboard' }).click()
    await openSettings(alice)
    await alice.getByRole('tab', { name: 'Blocked users' }).click()
    await expect(alice.getByText('Bob')).toBeVisible()
    await alice.getByRole('button', { name: 'Unblock' }).click()
    await expect(alice.getByText('No blocked users')).toBeVisible()
  })

  test('admin reviews the report in the UI and suspends the user; the user is cut off and can be restored', async ({ browser }) => {
    test.skip(!sql('select 1'), 'needs the local PostgreSQL to promote an admin')
    const { alice, bob } = await connectedPair(browser)
    await alice.getByRole('button', { name: 'End call' }).click()
    await expect(alice.getByRole('heading', { name: 'Call ended' })).toBeVisible()
    await alice.getByRole('button', { name: 'Report' }).click()
    const marker = `Moderation tour ${Date.now()}`
    await alice.getByLabel('Details (optional)').fill(marker)
    await alice.getByRole('button', { name: 'Send report' }).click()
    await expect(alice.getByText(/report sent/i)).toBeVisible()

    const { page: admin, email: adminEmail } = await signUpWithEmail(browser, 'Admintour')
    await admin.getByRole('button', { name: 'Account menu' }).click()
    await expect(admin.getByRole('menuitem', { name: 'Moderation' })).toHaveCount(0) // ordinary users do not see it
    await admin.keyboard.press('Escape')
    sql(`update users set role='ADMIN', email_verified=true where email='${adminEmail}'`)
    await admin.reload() // the refresh issues a token carrying the new role
    await admin.getByRole('button', { name: 'Account menu' }).click()
    await admin.getByRole('menuitem', { name: 'Moderation' }).click()
    await expect(admin.getByRole('heading', { name: 'Moderation' })).toBeVisible()

    const report = admin.getByRole('listitem').filter({ hasText: marker })
    await expect(report).toContainText('Bob')
    await expect(report).toContainText('Harassment')
    await report.getByRole('button', { name: 'Suspend user' }).click()
    const dialog = admin.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Suspend user' })).toBeDisabled() // a reason is required
    await dialog.getByLabel(/reason/i).fill('Confirmed during the e2e tour')
    await dialog.getByRole('button', { name: 'Suspend user' }).click()
    await expect(admin.getByRole('listitem').filter({ hasText: marker })).toHaveCount(0) // no longer open

    // Users tab shows the suspended account
    await admin.getByRole('tab', { name: 'users' }).click()
    await admin.getByLabel('Search by email or name').fill('Bob')
    await admin.getByRole('button', { name: 'Search' }).click()
    const bobRow = admin.getByRole('listitem').filter({ hasText: 'Reason: Confirmed during the e2e tour' })
    await expect(bobRow).toContainText('Suspended')

    // Bob is cut off immediately and cannot sign back in
    await bob.goto('/app')
    await expect(bob).toHaveURL(/\/login/)
    await bob.getByLabel('Email').fill('x@example.com') // placeholder; real address below
    const bobEmail = await bobRow.locator('p.truncate').nth(1).textContent()
    await bob.getByLabel('Email').fill(bobEmail!.trim())
    await bob.getByLabel('Password').fill(PASSWORD)
    await bob.getByRole('button', { name: 'Sign in' }).click()
    await expect(bob.getByRole('alert')).toContainText(/suspended/i)

    // Unsuspend restores access
    await bobRow.getByRole('button', { name: 'Unsuspend' }).click()
    await expect(admin.getByText('Reason: Confirmed during the e2e tour')).toHaveCount(0)
    await bob.getByRole('button', { name: 'Sign in' }).click()
    await expect(bob.getByRole('heading', { name: /welcome back, bob/i })).toBeVisible()
  })
})
