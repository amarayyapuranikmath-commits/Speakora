/**
 * A themed() style is passed straight to a component as its `style` (`<Text style={sectionLabel}>`). In development React Native then runs
 * deepFreezeAndThrowOnMutationInDev over the component's props. This is that same function, on the objects themed() returns.
 * Before the fix, themed() returned a Proxy over an empty object: freezing defined real properties on the empty target, and the Proxy's
 * own descriptors then contradicted them: "trap result is configurable but target property is non-configurable" (the red screen on the phone).
 */
import { StyleSheet } from 'react-native'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepFreeze = (require('react-native/Libraries/Utilities/deepFreezeAndThrowOnMutationInDev') as { default: <T>(o: T) => T }).default

import { applyScheme, colors, themed } from '../src/ui/theme'

afterEach(() => { applyScheme('light') })

describe('themed() with React Native\'s development-time deep freeze of props', () => {
  it('survives being passed as a style prop (the crash on the phone)', () => {
    const label = themed(() => ({ fontSize: 12, fontWeight: '600' as const, color: colors.muted }))
    expect(() => deepFreeze({ style: label, children: 'text' })).not.toThrow()
    expect(() => deepFreeze({ style: [label, { marginTop: 4 }] })).not.toThrow()
  })

  it('survives a StyleSheet-style object whose values are nested objects', () => {
    const styles = themed(() => StyleSheet.create({ card: { padding: 8, backgroundColor: colors.canvas }, title: { color: colors.ink } }))
    expect(() => deepFreeze({ style: styles.card })).not.toThrow()
    expect(() => deepFreeze({ style: styles })).not.toThrow()
  })

  it('still follows the theme after having been through the freeze (the freeze must not pin the first theme)', () => {
    const label = themed(() => ({ color: colors.ink, borderColor: colors.line }))
    const lightInk = label.color
    deepFreeze({ style: label })
    applyScheme('dark')
    expect(label.color).toBe(colors.ink)
    expect(label.color).not.toBe(lightInk)
    applyScheme('light')
    expect(label.color).toBe(lightInk)
  })

  it('behaves like the plain object: spread, keys, in, and style flattening', () => {
    const label = themed(() => ({ fontSize: 12, color: colors.ink }))
    expect({ ...label }).toEqual({ fontSize: 12, color: colors.ink })
    expect(Object.keys(label)).toEqual(['fontSize', 'color'])
    expect('fontSize' in label).toBe(true)
    expect('nope' in label).toBe(false)
    expect(StyleSheet.flatten([label, { marginTop: 2 }])).toEqual({ fontSize: 12, color: colors.ink, marginTop: 2 })
  })

  it('a themed style cannot be changed from code, and nothing is added to it', () => {
    const label = themed(() => ({ fontSize: 12 }))
    try { (label as { fontSize: number }).fontSize = 99 } catch { /* strict mode throws, sloppy mode ignores: either way ... */ }
    try { (label as Record<string, unknown>).extra = 1 } catch { /* ... */ }
    expect(label.fontSize).toBe(12) // ... the value is unchanged
    expect(Object.isSealed(label)).toBe(true)
    expect(Object.keys(label)).toEqual(['fontSize'])
  })
})
