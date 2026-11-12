import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { TABS, activeTabId, visibleTabs } from '../config/navigation'
import { ProfileMenu } from './ProfileMenu'
import { TopTabs } from './TopTabs'

describe('navigation structure', () => {
  it('the six agreed sections exist in the agreed order', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Home', 'Talk', 'Learn', 'AI Coach', 'Friends', 'Progress'])
  })

  it('only sections that are built are shown; unbuilt ones appear only in design-review preview', () => {
    expect(visibleTabs(false).map((t) => t.label)).toEqual(['Home', 'Talk', 'Learn', 'AI Coach', 'Friends', 'Progress'])
    expect(visibleTabs(true).map((t) => t.label)).toEqual(['Home', 'Talk', 'Learn', 'AI Coach', 'Friends', 'Progress'])
    for (const t of visibleTabs(false)) expect(t.ready).toBe(true)
  })

  it.each([
    ['/app', 'home'], ['/app/', 'home'],
    ['/app/talk', 'talk'], ['/app/partners', 'talk'], ['/app/history', 'talk'], ['/app/topics', 'talk'],
    ['/app/learn', 'learn'], ['/app/learn/grammar/tenses', 'learn'],
    ['/app/coach', 'coach'], ['/app/friends', 'friends'], ['/app/progress', 'progress'],
    ['/app/settings', null], ['/app/admin', null], ['/login', null],
  ])('%s belongs to the %s tab', (path, tab) => {
    expect(activeTabId(path)).toBe(tab)
  })

  it('Home matches only its own page, never every page under /app', () => {
    expect(activeTabId('/app/progress')).not.toBe('home')
  })
})

function renderTabs(path: string, preview = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TopTabs tabs={visibleTabs(preview)} />
    </MemoryRouter>,
  )
}

describe('TopTabs', () => {
  it('is one labelled horizontal navigation and there is no sidebar', () => {
    const { container } = renderTabs('/app')
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(container.querySelector('aside')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('shows the built tabs as links to their pages', () => {
    renderTabs('/app')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'Talk', 'Learn', 'AI Coach', 'Friends', 'Progress'])
    expect(within(nav).getByRole('link', { name: 'Talk' })).toHaveAttribute('href', '/app/talk')
    expect(within(nav).getByRole('link', { name: 'Friends' })).toHaveAttribute('href', '/app/friends')
    expect(within(nav).getByRole('link', { name: 'Learn' })).toHaveAttribute('href', '/app/learn')
  })

  it('shows a count on a tab only when there is something waiting', () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <TopTabs tabs={visibleTabs(false)} badges={{ friends: 3 }} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /Friends/ })).toHaveTextContent('3 unread')
    expect(screen.getByRole('link', { name: 'Talk' })).not.toHaveTextContent('unread')
  })

  it('marks exactly the current section, including when on one of its sub-pages', () => {
    renderTabs('/app/partners')
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')
    expect(current.map((a) => a.textContent)).toEqual(['Talk'])
  })

  it('marks no tab on a profile-menu page such as Settings', () => {
    renderTabs('/app/settings')
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(0)
  })

  it('preview mode adds the two unbuilt tabs in their place', () => {
    renderTabs('/app/learn', true)
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'Talk', 'Learn', 'AI Coach', 'Friends', 'Progress'])
    expect(screen.getByRole('link', { name: 'Learn' })).toHaveAttribute('aria-current', 'page')
  })
})

function renderMenu(over: Partial<React.ComponentProps<typeof ProfileMenu>> = {}) {
  const onSignOut = vi.fn()
  render(
    <MemoryRouter>
      <ProfileMenu name="Ana Lopez" isAdmin={false} onSignOut={onSignOut} {...over} />
    </MemoryRouter>,
  )
  return { onSignOut }
}

describe('ProfileMenu', () => {
  it('is closed until opened, then lists Settings and Sign out', async () => {
    renderMenu()
    const button = screen.getByRole('button', { name: 'Account menu' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Account' })
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Settings', 'Sign out'])
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/app/settings')
  })

  it('shows Moderation only to administrators', async () => {
    renderMenu({ isAdmin: true })
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('menuitem', { name: 'Moderation' })).toHaveAttribute('href', '/app/admin')
  })

  it('Sign out calls the sign-out action and closes the menu', async () => {
    const { onSignOut } = renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Escape closes it and returns focus to the button', async () => {
    renderMenu()
    const button = screen.getByRole('button', { name: 'Account menu' })
    await userEvent.click(button)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(button).toHaveFocus()
  })

  it('opening moves focus into the menu and the arrow keys move between items', async () => {
    renderMenu({ isAdmin: true })
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Moderation' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus() // wraps
  })

  it('clicking elsewhere closes it', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    await userEvent.click(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
