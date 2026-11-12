import { Loader2 } from 'lucide-react'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse'
type Size = 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-[color,background-color,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 select-none'
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-canvas',
  ghost: 'text-muted hover:bg-black/5 hover:text-ink',
  danger: 'bg-danger text-white hover:bg-[#8f1d13]',
  /** For use on accent-coloured panels. */
  inverse: 'bg-white text-accent hover:bg-accent-soft',
}
const sizes: Record<Size, string> = { md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' }

function classes(variant: Variant, size: Size, extra?: string) {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra ?? ''}`
}


interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export function Button({ variant = 'primary', size = 'md', loading, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={classes(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

interface LinkButtonProps extends LinkProps {
  variant?: Variant
  size?: Size
  children: ReactNode
}

/** A plain anchor styled as a button, for file downloads and other links that must not go through the router. */
export function AnchorButton({ variant = 'primary', size = 'md', className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  return (
    <a className={classes(variant, size, className)} {...rest}>
      {children}
    </a>
  )
}

export function LinkButton({ variant = 'primary', size = 'md', className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={classes(variant, size, className)} {...rest}>
      {children}
    </Link>
  )
}
