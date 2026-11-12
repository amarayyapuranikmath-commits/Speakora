import { expect, type Browser, type Page } from '@playwright/test'

/** Registers a real user through the UI and completes onboarding. */
export async function signUp(browser: Browser, name: string): Promise<Page> {
  return (await signUpWithEmail(browser, name)).page
}

export const PASSWORD = 'Passw0rdOK'

/** Signing up is finished only after the emailed code is entered. The tests have no mailbox: they read the emailed link from the backend log. */
export async function verifyByEmailedLink(page: Page, email: string): Promise<void> {
  await expect.poll(() => emailedToken(email, 'verify-email'), { message: 'verification link in the backend log' }).not.toBeNull()
  await page.goto(`/verify-email?token=${emailedToken(email, 'verify-email')}`)
}

/** The profile set-up that follows a verified sign-up. */
export async function completeOnboarding(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('heading', { name: /set up your profile/i })).toBeVisible()
  await page.getByLabel('Country').selectOption('GB')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Native language').selectOption('es')
  await page.getByRole('radio', { name: /B1/ }).check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('group', { name: /conversation interests/i }).getByRole('button', { name: 'Travel' }).click()
  await page.getByRole('button', { name: 'Finish' }).click()
  await expect(page.getByRole('heading', { name: new RegExp(`welcome back, ${name}`, 'i') })).toBeVisible()
}

/** `verify: false` stops at the code screen, for tests of the verification step itself. */
export async function signUpWithEmail(browser: Browser, name: string, { verify = true }: { verify?: boolean } = {}): Promise<{ page: Page; email: string }> {
  const context = await browser.newContext({ permissions: ['microphone'] })
  const page = await context.newPage()
  const unique = `${name.toLowerCase()}.${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`

  await page.goto('/register')
  await page.getByLabel('Display name').fill(name)
  await page.getByLabel('Email').fill(unique)
  await page.getByLabel('Date of birth').fill('1990-05-01')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account' }).click()

  // Account created: the only screen that opens now is the code screen.
  await expect(page.getByRole('heading', { name: /verify your email/i })).toBeVisible()
  if (!verify) return { page, email: unique }
  await verifyByEmailedLink(page, unique)
  await completeOnboarding(page, name)
  return { page, email: unique }
}

/** Two users start searching and both reach the Connected state. */
export async function connectedPair(browser: Browser): Promise<{ alice: Page; bob: Page }> {
  const [alice, bob] = [await signUp(browser, 'Alice'), await signUp(browser, 'Bob')]
  for (const page of [alice, bob]) {
    await page.getByRole('link', { name: /start speaking/i }).click()
    await page.getByRole('button', { name: /start looking/i }).click()
  }
  for (const page of [alice, bob]) {
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 })
  }
  return { alice, bob }
}

export interface RemoteAudio {
  tracks: number
  live: number
  unmuted: number
  paused: boolean | null
  playedSeconds: number
}

/** State of the provider-owned <audio> element that plays the partner's voice. */
export const remoteAudio = (page: Page): Promise<RemoteAudio> =>
  page.evaluate(() => {
    const el = document.querySelector('audio') as HTMLAudioElement | null
    const tracks = (el?.srcObject as MediaStream | null)?.getAudioTracks() ?? []
    return {
      tracks: tracks.length,
      live: tracks.filter((t) => t.readyState === 'live').length,
      unmuted: tracks.filter((t) => !t.muted).length, // a remote track is unmuted only while RTP is arriving
      paused: el?.paused ?? null,
      playedSeconds: el?.currentTime ?? 0,
    }
  })

/** Peak amplitude (0..1) of the audio actually being played to this user over `ms` milliseconds. */
export const peakLevel = (page: Page, ms: number): Promise<number> =>
  page.evaluate(async (duration) => {
    const el = document.querySelector('audio') as HTMLAudioElement
    const ctx = new AudioContext()
    await ctx.resume()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    ctx.createMediaStreamSource(el.srcObject as MediaStream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    let peak = 0
    const end = performance.now() + duration
    while (performance.now() < end) {
      analyser.getFloatTimeDomainData(samples)
      for (const s of samples) peak = Math.max(peak, Math.abs(s))
      await new Promise((r) => setTimeout(r, 40))
    }
    await ctx.close()
    return peak
  }, ms)

/* ---- helpers that read the backend's own log / database (local development stack only) ---- */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const BACKEND_LOG = process.env.E2E_BACKEND_LOG ?? join(tmpdir(), 'esp-backend.log')

/** Without SMTP the backend logs each email, link included. Returns the newest token sent to `email`. */
export function emailedToken(email: string, kind: 'verify-email' | 'reset-password'): string | null {
  if (!existsSync(BACKEND_LOG)) return null
  const log = readFileSync(BACKEND_LOG, 'utf8')
  const subject = kind === 'verify-email' ? 'Verify your email' : 'Reset your [^|\\n]*password'
  const re = new RegExp(`Email to ${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| ${subject}[\\s\\S]*?${kind}\\?token=([A-Za-z0-9_-]+)`, 'g')
  let last: string | null = null
  for (const m of log.matchAll(re)) last = m[1]
  return last
}

function dbPassword(): string | null {
  const envFile = join(process.cwd(), '..', '.env')
  if (!existsSync(envFile)) return null
  return readFileSync(envFile, 'utf8').match(/^DB_PASSWORD=([^\r\n]*)$/m)?.[1] ?? null
}

/** Direct SQL against the local dev database (to promote an admin). Returns false when unavailable. */
export function sql(statement: string): boolean {
  const password = dbPassword()
  const psql = process.env.PSQL_PATH ?? 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe'
  if (!password || !existsSync(psql)) return false
  execFileSync(psql, ['-U', 'esp_app', '-h', 'localhost', '-d', 'english_speaking', '-w', '-tA', '-c', statement], { env: { ...process.env, PGPASSWORD: password } })
  return true
}

/* ---- navigation: the main tabs are in the top bar; Settings and Sign out live in the account menu ---- */

export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
}

/** Previous partners and Call history are sub-pages of the Talk tab. */
export async function openPartners(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Talk' }).click()
  await page.getByRole('link', { name: 'Previous partners' }).click()
}

export async function openHistory(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Talk' }).click()
  await page.getByRole('link', { name: 'Call history' }).click()
}

export async function openFriends(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Friends/ }).click()
  await expect(page.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible()
}
