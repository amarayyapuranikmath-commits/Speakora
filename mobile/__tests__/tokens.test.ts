/// <reference types="node" />
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { colors, radius, space, type } from '../src/ui/theme'

const repo = join(__dirname, '..', '..')
const tokens = JSON.parse(readFileSync(join(repo, 'design', 'tokens.json'), 'utf8'))

describe('design tokens on Android', () => {
  it('the generated theme file matches design/tokens.json', () => {
    expect(() => execFileSync('node', [join(repo, 'design', 'build-tokens.cjs'), '--check'], { stdio: 'pipe' })).not.toThrow()
  })

  it('the app theme is exactly the shared tokens (same colours, spacing and radii as the website)', () => {
    for (const [name, value] of Object.entries(tokens.color)) expect((colors as Record<string, string>)[name]).toBe(value)
    expect(colors.accentPressed).toBe(tokens.color.accentHover) // older screens use this name
    expect(space).toEqual(tokens.space)
    expect(radius).toEqual(tokens.radius)
  })

  it('every text style comes from the shared type scale', () => {
    for (const name of ['display', 'title', 'heading', 'subheading', 'body', 'small', 'caption'] as const) {
      expect(type[name].fontSize).toBe(tokens.type[name].size)
      expect(type[name].lineHeight).toBe(tokens.type[name].line)
      expect(type[name].fontWeight).toBe(String(tokens.type[name].weight))
    }
  })
})
