import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAndroidDownloadUrl } from '../../lib/androidDownload'

describe('resolveAndroidDownloadUrl', () => {
  it('accepts a public https address and a same-site path', () => {
    expect(resolveAndroidDownloadUrl('https://speak.example.com/downloads/app.apk')).toBe('https://speak.example.com/downloads/app.apk')
    expect(resolveAndroidDownloadUrl('/downloads/speakora.apk')).toBe('/downloads/speakora.apk')
  })

  it.each([
    '', '   ', undefined, 'http://speak.example.com/app.apk', 'https://localhost/app.apk', 'https://10.0.2.2/app.apk',
    'https://192.168.1.20/app.apk', 'https://intranet/app.apk', 'C:\\Users\\me\\app.apk', 'file:///C:/app.apk', '//evil.test/app.apk', 'javascript:alert(1)',
  ])('rejects %s', (raw) => {
    expect(resolveAndroidDownloadUrl(raw as string | undefined)).toBeNull()
  })
})

describe('landing page', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('../../config/brand')
  })

  async function renderLanding(androidDownloadUrl: string | null) {
    vi.doMock('../../config/brand', () => ({ brand: { name: 'Speakora', tagline: '', supportEmail: '', androidDownloadUrl } }))
    const { LandingPage } = await import('./LandingPage')
    return render(<MemoryRouter><LandingPage /></MemoryRouter>)
  }

  it('says what the product really is, with actions that lead to real destinations', async () => {
    await renderLanding(null)
    expect(screen.getByRole('heading', { level: 1, name: 'Speak English with real people.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start Speaking' })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: /read more about safety/i })).toHaveAttribute('href', '/safety')
    for (const id of ['how-it-works', 'features', 'safety']) expect(document.getElementById(id)).not.toBeNull()
  })

  it('shows the five real features briefly, in order, each with one short line', async () => {
    const { container } = await renderLanding(null)
    const features = document.getElementById('features')!
    const titles = Array.from(features.querySelectorAll('li h3')).map((h) => h.textContent)
    expect(titles).toEqual(['Quick Match', 'AI Coach', 'Learn', 'Friends', 'Progress'])
    for (const p of Array.from(features.querySelectorAll('li p'))) expect((p.textContent ?? '').length).toBeLessThan(150)
    const text = container.textContent ?? ''
    expect(text).toMatch(/Only friends can message or call you privately/)
    expect(text).toMatch(/Grammar, vocabulary and phrasal verbs, with a daily plan, practice tests and revision/)
    expect(text).toMatch(/Your conversation is not saved/)
    expect(text).toMatch(/Calls are never recorded/)
  })

  it('does not advertise anything that is not built: no pronunciation scoring, AI voice calls, exams or certificates', async () => {
    const { container } = await renderLanding(null)
    expect(container.textContent).not.toMatch(/IELTS|TOEFL|certificate|fluent in|guarantee|AI voice|talk to the AI|score your accent|real-time translation|video/i)
    expect(screen.queryByRole('link', { name: /start learning/i })).toBeNull()
  })

  it('contains no invented numbers or promises: no counts, ratings, testimonials, "free" or "around the world"', async () => {
    const { container } = await renderLanding(null)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/\b\d[\d,.]*\+?\s*(users|learners|members|people|countries|calls|reviews)\b/i)
    expect(text).not.toMatch(/★|stars?\b|rated|testimonial|\bfree\b|around the world|worldwide|thousands|millions|best\b/i)
  })

  it('keeps every list in a single column: no multi-column grids', async () => {
    const { container } = await renderLanding(null)
    expect(container.querySelector('[class*="grid-cols"]')).toBeNull()
    expect(container.querySelector('aside')).toBeNull()
  })

  it('shows working download links (hero and section) only when a real URL is configured', async () => {
    await renderLanding('https://speak.example.com/downloads/speakora.apk')
    const links = screen.getAllByRole('link', { name: /download android app/i })
    expect(links).toHaveLength(2)
    for (const l of links) {
      expect(l).toHaveAttribute('href', 'https://speak.example.com/downloads/speakora.apk')
      expect(l).toHaveAttribute('download')
    }
    expect(document.getElementById('android-app')).not.toBeNull()
  })

  it('shows no Android section, button or note at all when there is no download yet', async () => {
    const { container } = await renderLanding(null)
    expect(screen.queryByRole('link', { name: /download android app/i })).toBeNull()
    expect(document.getElementById('android-app')).toBeNull()
    expect(container.textContent).not.toMatch(/android/i)
  })
})
