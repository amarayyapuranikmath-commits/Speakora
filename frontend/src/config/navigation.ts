import { BookOpen, Home, LineChart, Mic, Sparkles, Users, type LucideIcon } from 'lucide-react'

/**
 * The six main sections, in order. There is no sidebar anywhere: these are the tabs of the top bar.
 *
 * A tab is shown only when its section is `ready` (built and verified), so the navigation never advertises something that does not
 * exist. For design review the unbuilt tabs can be previewed with VITE_SHOW_UNBUILT_TABS=1; they then open a page that says plainly
 * that the section is not available yet. Flip `ready` to true in the phase that delivers the section.
 */
export interface Tab {
  id: 'home' | 'talk' | 'learn' | 'coach' | 'friends' | 'progress'
  label: string
  to: string
  icon: LucideIcon
  /** Path prefixes that keep this tab highlighted, so sub-pages (e.g. Previous partners under Talk) stay inside their section. */
  match: string[]
  /** Home matches only its own path, not everything under /app. */
  exact?: boolean
  ready: boolean
}

export const TABS: Tab[] = [
  { id: 'home', label: 'Home', to: '/app', icon: Home, match: ['/app'], exact: true, ready: true },
  { id: 'talk', label: 'Talk', to: '/app/talk', icon: Mic, match: ['/app/talk', '/app/partners', '/app/history', '/app/topics'], ready: true },
  { id: 'learn', label: 'Learn', to: '/app/learn', icon: BookOpen, match: ['/app/learn'], ready: true },
  { id: 'coach', label: 'AI Coach', to: '/app/coach', icon: Sparkles, match: ['/app/coach'], ready: true },
  { id: 'friends', label: 'Friends', to: '/app/friends', icon: Users, match: ['/app/friends'], ready: true },
  { id: 'progress', label: 'Progress', to: '/app/progress', icon: LineChart, match: ['/app/progress'], ready: true },
]

export const previewUnbuiltTabs = import.meta.env.VITE_SHOW_UNBUILT_TABS === '1'

export function visibleTabs(preview: boolean = previewUnbuiltTabs): Tab[] {
  return TABS.filter((t) => t.ready || preview)
}

/** The tab that owns this path, or null for pages that belong to the profile menu (Settings, Moderation). */
export function activeTabId(pathname: string): Tab['id'] | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  for (const tab of TABS) {
    if (tab.exact ? path === tab.to : tab.match.some((m) => path === m || path.startsWith(m + '/'))) return tab.id
  }
  return null
}
