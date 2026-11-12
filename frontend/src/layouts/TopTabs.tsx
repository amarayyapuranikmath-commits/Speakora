import { Link, useLocation } from 'react-router-dom'
import { activeTabId, visibleTabs, type Tab } from '../config/navigation'

/**
 * The main navigation: a horizontal tab bar. On wide screens it sits in the header next to the logo with icon and label side by
 * side; on narrow screens it becomes its own row under the header, the tabs share the width equally (icon above label), so every
 * tab is always visible and nothing scrolls sideways. The current tab is shown with an underline, not a filled pill.
 */
export function TopTabs({ tabs = visibleTabs(), badges = {} }: { tabs?: Tab[]; badges?: Partial<Record<Tab['id'], number>> }) {
  const { pathname } = useLocation()
  const current = activeTabId(pathname)
  return (
    <nav aria-label="Main" className="order-3 basis-full lg:order-2 lg:basis-auto">
      <ul className="flex items-stretch lg:gap-1">
        {tabs.map(({ id, label, to, icon: Icon }) => {
          const active = id === current
          const badge = badges[id] ?? 0
          return (
            <li key={id} className="min-w-0 flex-1 lg:flex-none">
              <Link
                to={to}
                aria-current={active ? 'page' : undefined}
                className={`relative flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium leading-none transition-colors duration-[var(--motion-fast)] lg:flex-row lg:gap-2 lg:px-3 lg:text-sm ${active ? 'text-ink' : 'text-muted hover:text-ink'}`}
              >
                <Icon className="size-4" aria-hidden />
                {label}
                {badge > 0 && (
                  <span className="absolute right-1/2 top-2 translate-x-5 rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-4 text-white lg:static lg:translate-x-0">
                    <span aria-hidden>{badge > 9 ? '9+' : badge}</span>
                    <span className="sr-only">{badge} unread</span>
                  </span>
                )}
                <span
                  aria-hidden
                  className={`absolute inset-x-2 bottom-0 lg:inset-x-3 h-0.5 rounded-full bg-accent transition-opacity duration-[var(--motion-base)] ${active ? 'opacity-100' : 'opacity-0'}`}
                />
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
