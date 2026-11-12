import { LogOut, Settings, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../components/ui/Avatar'

/**
 * The small profile control at the right of the header. It holds everything that is not a main section: Settings, Moderation (for
 * administrators) and Sign out. Keyboard: Enter/Space opens it, arrows move, Escape closes and returns focus to the button.
 */
export function ProfileMenu({ name, isAdmin, onSignOut }: { name: string; isAdmin: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const items = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    items()[0]?.focus()
    const close = (returnFocus: boolean) => {
      setOpen(false)
      if (returnFocus) button.current?.focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(true)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const list = items()
        const i = list.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length
        list[next]?.focus()
      } else if (e.key === 'Tab') {
        close(false)
      }
    }
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  const item = 'flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-sm text-ink hover:bg-black/5 focus-visible:bg-black/5'

  return (
    <div ref={root} className="relative order-2 ml-auto lg:order-3 lg:ml-0">
      <button
        ref={button}
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center rounded-full p-0.5 hover:ring-2 hover:ring-line-strong aria-expanded:ring-2 aria-expanded:ring-line-strong"
      >
        <Avatar name={name} size={32} />
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 z-40 mt-2 w-56 rounded-panel border border-line bg-surface p-1 shadow-overlay">
          <p className="truncate px-3 py-2 text-sm font-medium" role="presentation">{name}</p>
          <div className="my-1 h-px bg-line" role="separator" />
          <Link to="/app/settings" role="menuitem" className={item} onClick={() => setOpen(false)}>
            <Settings className="size-4 text-muted" aria-hidden /> Settings
          </Link>
          {isAdmin && (
            <Link to="/app/admin" role="menuitem" className={item} onClick={() => setOpen(false)}>
              <ShieldCheck className="size-4 text-muted" aria-hidden /> Moderation
            </Link>
          )}
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onSignOut() }}>
            <LogOut className="size-4 text-muted" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
