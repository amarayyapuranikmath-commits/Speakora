/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = join(process.cwd(), '..')
const tokens = JSON.parse(readFileSync(join(repo, 'design', 'tokens.json'), 'utf8')) as {
  color: Record<string, string>
  type: Record<string, { size: number; line: number; weight: number }>
  radius: Record<string, number>
  layout: { reading: number; app: number }
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const c = tokens.color

describe('design tokens', () => {
  it('the generated website and Android files match design/tokens.json', () => {
    // Exits non-zero (and throws here) when someone edits tokens.json or a generated file without regenerating.
    expect(() => execFileSync('node', [join(repo, 'design', 'build-tokens.cjs'), '--check'], { stdio: 'pipe' })).not.toThrow()
  })

  it('the website stylesheet takes its tokens from the generated file and does not redefine the palette', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')
    expect(css).toContain("@import './design/tokens.css'")
    expect(css).not.toMatch(/--color-[a-z-]+:\s*#/)
  })

  it.each([
    ['ink', 'canvas'], ['ink', 'surface'], ['ink', 'accentSoft'],
    ['muted', 'canvas'], ['muted', 'surface'], ['muted', 'accentSoft'],
    ['subtle', 'canvas'], ['subtle', 'surface'],
    ['accent', 'canvas'], ['accent', 'surface'], ['accent', 'accentSoft'],
    ['white', 'accent'], ['white', 'accentHover'], ['white', 'danger'],
    ['danger', 'surface'], ['danger', 'canvas'], ['danger', 'dangerSoft'],
    ['warning', 'warningSoft'], ['warning', 'surface'],
    ['success', 'successSoft'], ['success', 'surface'],
  ])('text %s on %s meets WCAG AA (4.5:1)', (fg, bg) => {
    expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5)
  })

  it.each([['field', 'surface'], ['field', 'canvas'], ['accent', 'canvas']])('%s against %s meets the 3:1 rule for input borders and focus rings', (fg, bg) => {
    expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(3)
  })

  it('the type scale is monotonic and every style has a comfortable line height', () => {
    const order = ['display', 'title', 'heading', 'subheading', 'body', 'small', 'caption']
    const sizes = order.map((k) => tokens.type[k].size)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    for (const k of order) expect(tokens.type[k].line / tokens.type[k].size).toBeGreaterThanOrEqual(1.1)
    expect(tokens.type.body.size).toBeGreaterThanOrEqual(16) // body text never below 16px
    expect(tokens.type.body.line / tokens.type.body.size).toBeGreaterThanOrEqual(1.5)
  })

  it('stays restrained: small radii and a narrow reading column', () => {
    expect(tokens.radius.control).toBeLessThanOrEqual(10)
    expect(tokens.radius.panel).toBeLessThanOrEqual(14)
    expect(tokens.layout.reading).toBeLessThanOrEqual(720)
  })
})
