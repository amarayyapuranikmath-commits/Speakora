import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AVATAR_LIGHTNESS, AVATAR_SATURATION } from '../../lib/initials'
import { Avatar } from './Avatar'

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = ([r, g, b]: [number, number, number]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

describe('Avatar', () => {
  it('white initials are readable (WCAG AA, 4.5:1) on EVERY possible avatar colour', () => {
    let worst = Infinity
    for (let hue = 0; hue < 360; hue++) {
      const ratio = (1 + 0.05) / (lum(hslToRgb(hue, AVATAR_SATURATION, AVATAR_LIGHTNESS)) + 0.05)
      worst = Math.min(worst, ratio)
    }
    expect(worst).toBeGreaterThanOrEqual(4.5)
  })

  it('draws the initials with CSS, so they are not text and cannot change the accessible name of a button around them', () => {
    const { container } = render(<button aria-label="Account menu"><Avatar name="Ana Lopez" /></button>)
    const avatar = container.querySelector('[data-initials]') as HTMLElement
    expect(avatar.getAttribute('data-initials')).toBe('AL')
    expect(avatar.textContent).toBe('')
    expect(container.querySelector('button')?.textContent).toBe('')
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
  })

  it('the same name always gets the same colour', () => {
    const style = (name: string) => (render(<Avatar name={name} />).container.firstElementChild as HTMLElement).style.backgroundColor
    expect(style('Pat')).toBe(style('Pat'))
    expect(style('Pat')).not.toBe(style('Quinn'))
  })
})
