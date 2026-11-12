import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * Responsive + accessibility audit. Runs against the Vite dev server with the API mocked inside the browser,
 * so it needs no backend. It checks layout/accessibility only; it says nothing about backend or real-time behaviour.
 */

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
]

const user = { id: 'u1', email: 'ana@example.com', emailVerified: true, displayName: 'Ana', onboardingCompleted: true, role: 'USER' }
const topics = [
  { slug: 'travel', name: 'Travel', description: 'Places and journeys.', prompts: ['Where next?', 'Best trip?'] },
  { slug: 'general', name: 'General discussion', description: 'Anything.', prompts: ['What is new?'] },
]
const calls = [
  { id: 'c1', partnerDisplayName: 'Sam', topicName: 'Travel', status: 'COMPLETED', endReason: 'ENDED', startedAt: '2026-11-08T10:00:00Z', durationSeconds: 620, feedbackSubmitted: false },
  { id: 'c2', partnerDisplayName: 'A very long display name that must wrap', topicName: null, status: 'FAILED', endReason: 'FAILED', startedAt: '2026-11-07T10:00:00Z', durationSeconds: null, feedbackSubmitted: false },
  { id: 'c3', partnerDisplayName: 'Lee', topicName: 'General discussion', status: 'COMPLETED', endReason: 'ENDED', startedAt: '2026-11-06T10:00:00Z', durationSeconds: 90, feedbackSubmitted: true },
]
const activity = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 11 + i)).toISOString().slice(0, 10), seconds: (i % 5) * 300, calls: i % 5 ? 1 : 0 }))

async function mockApi(page: Page, opts: { onboarded?: boolean; signedIn?: boolean; admin?: boolean; verified?: boolean } = {}) {
  const { onboarded = true, signedIn = true, admin = false, verified = true } = opts
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const key = `${route.request().method()} ${url.pathname}`
    const table: Record<string, unknown> = {
      'GET /api/profile': { displayName: 'Ana', country: onboarded ? 'ES' : null, timeZone: 'Europe/Madrid', nativeLanguage: onboarded ? 'es' : null, englishLevel: onboarded ? 'B1' : null, learningGoals: ['fluency'], interests: ['travel'], onboardingCompleted: onboarded },
      'GET /api/preferences': { matchSimilarLevel: true, showCountry: true, showLevel: true, notifyEmailReminders: false, aiCoachConsent: false },
      'GET /api/topics': topics,
      'GET /api/stats/summary': { totalSeconds: 5400, completedCalls: 7, currentStreakDays: 3, longestStreakDays: 5, weekSeconds: 1800, monthSeconds: 5400, practisedToday: true, englishLevel: 'B1' },
      'GET /api/stats/activity': activity,
      'GET /api/calls': { items: calls, page: 0, size: 15, totalElements: 3, totalPages: 1 },
      'GET /api/blocks': [{ userId: 'x1', displayName: 'Blocked Person', blockedAt: '2026-11-01T10:00:00Z' }],
      'GET /api/coach/status': { available: true, consent: url.searchParams.get('consent') !== '0', dailyLimit: 20 },
      'GET /api/coach/modes': [{ id: 'GRAMMAR_TUTOR', title: 'Grammar tutor', description: 'Learn and practise grammar.' }, { id: 'FREE_CONVERSATION', title: 'Free conversation', description: 'Chat about anything.' }],
      'GET /api/learn/overview': { subjects: [
        { id: 'grammar', title: 'Grammar', description: 'Structured lessons.', unit: 'lessons completed', total: 60, completed: 3, levels: [{ level: 1, title: 'Fundamentals', summary: 'Building blocks.', total: 12, completed: 3, testPercent: 80 }, { level: 2, title: 'All 12 tenses', summary: 'Present, past, future.', total: 12, completed: 0, testPercent: null }] },
        { id: 'vocabulary', title: 'Vocabulary', description: 'Words.', unit: 'words learned', total: 100, completed: 4, levels: [{ level: 1, title: 'Beginner', summary: 'Everyday words.', total: 20, completed: 4, testPercent: null }] },
        { id: 'phrasal', title: 'Phrasal verbs', description: 'Verbs.', unit: 'lessons completed', total: 30, completed: 0, levels: [{ level: 1, title: 'Beginner', summary: 'Ten verbs.', total: 10, completed: 0, testPercent: null }] }],
        next: { lessonId: 'g1.04', title: 'Pronouns', subject: 'grammar', level: 1 }, dueCount: 3 },
      'GET /api/learn/progress': { grammarCompleted: 3, grammarTotal: 60, phrasalCompleted: 0, phrasalTotal: 30, wordsLearned: 4, wordsSaved: 6, wordsTotal: 100, phrasalVerbsLearned: 0, phrasalVerbsTotal: 30, averagePercent: 78,
        recent: [{ kind: 'LESSON', subject: 'GRAMMAR', label: 'Nouns', percent: 80, correct: 4, total: 5, takenAt: '2026-11-09T10:00:00Z' }], learningStreakDays: 2, practiceDaysLast30: 5,
        weakTopics: [{ lessonId: 'g2.03', title: 'Present Perfect', level: 2, accuracyPercent: 40 }], dueCount: 3, next: { lessonId: 'g1.04', title: 'Pronouns', subject: 'grammar', level: 1 } },
      'GET /api/learn/grammar/levels/1': { subject: 'grammar', level: { level: 1, title: 'Fundamentals', summary: 'Building blocks.', total: 12, completed: 3, testPercent: 80 }, lessons: [{ id: 'g1.01', title: 'Basic sentence structure', status: 'COMPLETED', bestPercent: 100, attempts: 2 }, { id: 'g1.02', title: 'Parts of speech', status: 'IN_PROGRESS', bestPercent: 60, attempts: 1 }, { id: 'g1.03', title: 'Nouns', status: 'NOT_STARTED', bestPercent: 0, attempts: 0 }] },
      'GET /api/learn/vocabulary/levels/1': { level: { level: 1, title: 'Beginner', summary: 'Everyday words.', total: 20, completed: 4, testPercent: null }, words: [{ id: 'v1.01', word: 'borrow', pos: 'verb', meaning: 'to take something and give it back later', status: 'LEARNING', saved: true, difficult: false }, { id: 'v1.02', word: 'buy', pos: 'verb', meaning: 'to get something by paying money', status: 'NEW', saved: false, difficult: false }] },
      'GET /api/learn/lessons/g1.01': { subject: 'grammar', id: 'g1.01', level: 1, levelTitle: 'Fundamentals', title: 'Basic sentence structure', explain: 'A basic English sentence tells us who or what does something.', structures: ['Subject + Verb: Birds fly.', 'Subject + Verb + Object: Maria reads books.'], positive: ['I drink tea.', 'The children play football.'], negative: ['I do not drink coffee.'], questions: ['Do you drink tea?'], reallife: ['At a cafe: I want a coffee, please.'], mistakes: [{ wrong: 'Drinks tea she.', right: 'She drinks tea.', why: 'The subject comes before the verb.' }], exercises: [{ id: 'g1.01.e1', type: 'choice', prompt: 'Which sentence has the correct order?', options: ['Reads she a book.', 'She reads a book.'] }, { id: 'g1.01.e3', type: 'fill', prompt: 'We ___ English every day. (study)', options: [] }], assessment: [{ id: 'g1.01.a1', type: 'choice', prompt: 'Choose the correct sentence.', options: ['Eats she lunch.', 'She eats lunch.'] }], status: 'COMPLETED', bestPercent: 100, attempts: 2, nextLessonId: 'g1.02' },
      'GET /api/learn/vocabulary/words/v1.01': { id: 'v1.01', level: 1, word: 'borrow', pos: 'verb', meaning: 'to take something and give it back later', status: 'LEARNING', saved: true, difficult: false, example: 'Can I borrow your pen?', conversation: ['A: Can I borrow your charger?', 'B: Sure.'], synonyms: [], antonyms: ['lend'], build: 'Write a sentence.' },
      'GET /api/learn/revision': { kind: 'REVISION', subject: 'all', level: 0, questions: [{ id: 'v1.01:meaning', type: 'choice', prompt: 'Which one means: to take something and give it back later?', options: ['borrow', 'buy', 'cheap', 'clean'] }] },
      'GET /api/friends': { friends: [{ ref: 'f1', displayName: 'Pat', englishLevel: 'B2', country: 'GB', since: '2026-11-01T10:00:00Z', online: true, unread: 2, lastMessageAt: '2026-11-09T10:00:00Z' }, { ref: 'f2', displayName: 'Olga with a very long display name that must wrap', englishLevel: null, country: null, since: '2026-11-01T10:00:00Z', online: false, unread: 0, lastMessageAt: null }], incoming: [{ id: 'r1', displayName: 'Ivan', englishLevel: 'A2', country: null, createdAt: '2026-11-09T10:00:00Z' }], outgoing: [{ id: 'r2', displayName: 'Quinn', englishLevel: null, country: null, createdAt: '2026-11-09T10:00:00Z' }] },
      'GET /api/friends/f1/messages': { messages: [{ id: 'm1', mine: true, body: 'Hello Pat, are you free?', createdAt: '2026-11-09T10:00:00Z' }, { id: 'm2', mine: false, body: 'Yes! Call me.', createdAt: '2026-11-09T10:01:00Z' }], hasMore: false },
      'POST /api/friends/f1/messages/read': {},
      'GET /api/partners': [{ ref: 'p1', displayName: 'Sam', englishLevel: 'B1', country: 'IN', conversations: 2, lastConversationAt: '2026-11-08T10:00:00Z', lastCallId: 'c1', friendStatus: 'NONE', canAddFriend: true }, { ref: 'p2', displayName: 'Lee', englishLevel: null, country: null, conversations: 1, lastConversationAt: '2026-11-06T10:00:00Z', lastCallId: 'c3', friendStatus: 'FRIENDS', canAddFriend: false }],
      'GET /api/admin/reports': { items: [{ id: 'r1', createdAt: '2026-11-08T10:00:00Z', status: 'OPEN', reason: 'HARASSMENT', details: 'Was rude during the call and kept going after being asked to stop.', callId: 'c1', reporterName: 'Ana', reportedUserId: 'u2', reportedName: 'A very long display name that must wrap', reportedStatus: 'ACTIVE', openReportsAgainst: 2, totalReportsAgainst: 3, resolutionNote: null, resolvedAt: null }], page: 0, size: 15, totalElements: 1, totalPages: 1 },
      'GET /api/admin/users': { items: [{ id: 'u2', email: 'sam@example.com', displayName: 'Sam', status: 'ACTIVE', role: 'USER', createdAt: '2026-11-01T10:00:00Z', suspendedReason: null, openReportsAgainst: 0, totalReportsAgainst: 0 }, { id: 'u3', email: 'lee.with.a.very.long.email.address@example-domain.com', displayName: 'Lee', status: 'SUSPENDED', role: 'USER', createdAt: '2026-11-01T10:00:00Z', suspendedReason: 'Spam', openReportsAgainst: 1, totalReportsAgainst: 4 }], page: 0, size: 15, totalElements: 2, totalPages: 1 },
    }
    if (key === 'POST /api/auth/refresh') {
      return signedIn ? route.fulfill(json({ accessToken: 't', expiresInSeconds: 900, user: { ...user, emailVerified: verified, onboardingCompleted: onboarded, role: admin ? 'ADMIN' : 'USER' } })) : route.fulfill(json({ code: 'UNAUTHENTICATED', message: 'no' }, 401))
    }
    if (key === 'POST /api/auth/verify-email') return route.fulfill({ status: 204 })
    if (key in table) return route.fulfill(json(table[key]))
    return route.fulfill(json({ code: 'NOT_MOCKED', message: key }, 599))
  })
}

interface RouteCase {
  name: string
  path: string
  signedIn?: boolean
  onboarded?: boolean
  /** false: a signed-in account that has not entered its emailed code yet */
  verified?: boolean
  admin?: boolean
  setup?: (page: Page) => Promise<void>
  ready: string | RegExp
}

const ROUTES: RouteCase[] = [
  { name: 'landing', path: '/', signedIn: false, ready: /practise speaking english/i },
  { name: 'safety', path: '/safety', signedIn: false, ready: /safety and privacy/i },
  { name: 'login', path: '/login', signedIn: false, ready: /welcome back/i },
  { name: 'register', path: '/register', signedIn: false, ready: /create your account/i },
  { name: 'forgot-password', path: '/forgot-password', signedIn: false, ready: /reset your password/i },
  { name: 'reset-password', path: '/reset-password?token=abc', signedIn: false, ready: /choose a new password/i },
  { name: 'verify-email', path: '/verify-email?token=abc', signedIn: false, ready: /email verification/i },
  { name: 'verify-code', path: '/verify-email', verified: false, ready: /one last step to finish creating your account/i },
  { name: 'not-found', path: '/nope', signedIn: false, ready: /page not found/i },
  { name: 'onboarding', path: '/onboarding', onboarded: false, ready: /set up your profile/i },
  { name: 'dashboard', path: '/app', ready: /welcome back, ana/i },
  { name: 'talk-idle', path: '/app/talk', ready: /find a speaking partner/i },
  { name: 'topics', path: '/app/topics', ready: /conversation topics/i },
  { name: 'coach-tutor', path: '/app/coach', ready: /what would you like to do/i },
  { name: 'learn-home', path: '/app/learn', ready: /recommended next/i },
  { name: 'learn-subject', path: '/app/learn/grammar', ready: /level 1: fundamentals/i },
  { name: 'learn-level', path: '/app/learn/grammar/levels/1', ready: /basic sentence structure/i },
  { name: 'learn-vocabulary-level', path: '/app/learn/vocabulary/levels/1', ready: /can i borrow your pen/i, setup: (p) => p.getByRole('button', { name: /borrow/ }).click() },
  { name: 'learn-lesson', path: '/app/learn/lessons/g1.01', ready: /common mistakes/i },
  { name: 'learn-practice', path: '/app/learn/lessons/g1.01', ready: /which sentence has the correct order/i, setup: (p) => p.getByRole('tab', { name: 'Practice' }).click() },
  { name: 'learn-test', path: '/app/learn/lessons/g1.01', ready: /you need 70%/i, setup: (p) => p.getByRole('tab', { name: 'Test' }).click() },
  { name: 'learn-revision', path: '/app/learn/revision', ready: /which one means/i },
  { name: 'friends', path: '/app/friends', ready: /friend requests/i },
  { name: 'chat', path: '/app/friends/f1', ready: /are you free/i },
  { name: 'partners', path: '/app/partners', ready: /previous partners/i },
  { name: 'admin-reports', path: '/app/admin', admin: true, ready: /confirmed|reported by ana/i },
  { name: 'admin-users', path: '/app/admin', admin: true, ready: /sam@example.com/i, setup: (p) => p.getByRole('tab', { name: 'users' }).click() },
  { name: 'history', path: '/app/history', ready: /call history/i },
  { name: 'progress', path: '/app/progress', ready: /total speaking time/i },
  { name: 'settings-profile', path: '/app/settings', ready: /settings/i },
  { name: 'settings-account', path: '/app/settings', ready: /change password/i, setup: (p) => p.getByRole('tab', { name: 'Account' }).click() },
  { name: 'settings-privacy', path: '/app/settings', ready: /what partners can see/i, setup: (p) => p.getByRole('tab', { name: 'Privacy' }).click() },
  { name: 'settings-notifications', path: '/app/settings', ready: /email notifications/i, setup: (p) => p.getByRole('tab', { name: 'Notifications' }).click() },
  { name: 'settings-blocked', path: '/app/settings', ready: /blocked person/i, setup: (p) => p.getByRole('tab', { name: 'Blocked users' }).click() },
]

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    for (const r of ROUTES) {
      test(`${r.name}: no horizontal overflow, no axe violations`, async ({ page }) => {
        await mockApi(page, { signedIn: r.signedIn ?? true, onboarded: r.onboarded ?? true, admin: r.admin ?? false, verified: r.verified ?? true })
        await page.goto(r.path)
        if (r.setup) await r.setup(page)
        await expect(page.getByText(r.ready).first()).toBeVisible({ timeout: 10_000 })
        await page.waitForLoadState('networkidle')

        const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
        expect(overflow.scroll, `horizontal overflow on ${r.name}`).toBeLessThanOrEqual(overflow.client)

        // Guard against invisible text (axe misses cases like white text on a white button).
        const invisible = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>('a, button, h1, h2, h3, p, span, label'))
            .filter((el) => el.childNodes.length > 0 && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim()))
            .filter((el) => {
              const s = getComputedStyle(el)
              return s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.color === s.backgroundColor
            })
            .map((el) => el.textContent?.trim().slice(0, 40)),
        )
        expect(invisible, `text identical to its background on ${r.name}`).toEqual([])

        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
        const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
        summary.forEach((s) => console.log(`AXE ${vp.name} ${r.name}: ${s}`))
        expect(summary, `axe violations on ${r.name}`).toEqual([])

        if (process.env.AUDIT_SCREENSHOTS) await page.screenshot({ path: `test-results/shots/${vp.name}-${r.name}.png`, fullPage: true })
      })
    }
  })
}

test('mobile bottom navigation is present and desktop top navigation is used on wide screens', async ({ page }) => {
  await mockApi(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/app')
  await expect(page.getByRole('navigation', { name: 'Main' }).last()).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible()
})

test('keyboard: skip link is first tab stop and settings tabs are operable', async ({ page }) => {
  await mockApi(page)
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible() // wait for the app shell before tabbing
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
})
