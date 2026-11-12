import { useRef, useState } from 'react'
import { tokens } from './tokens.generated'

/**
 * Same palette, rhythm and type scale as the website: both are generated from design/tokens.json
 * (edit that file and run `node design/build-tokens.cjs`; never edit tokens.generated.ts by hand).
 *
 * The app has two palettes, light and dark (the dark one is in design/tokens.json under "android"). `colors` is ONE object whose values are
 * replaced when the theme changes (applyScheme), so every `colors.ink` that runs while a screen renders already has the right value.
 * Two rules follow from that:
 *   1. Never read `colors` or `type` when a module loads (a top-level `const x = { color: colors.ink }` would be stuck on the first theme).
 *      Use `themed(() => ({ ... }))` for styles and constants defined at the top of a file: it is rebuilt when the theme changes and is
 *      used exactly like a plain object.
 *   2. The screens are rebuilt when the theme changes (see ThemeProvider), so nothing needs to subscribe to it.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type Scheme = 'light' | 'dark'

export type Palette = { [K in keyof typeof tokens.colors]: string }

const LIGHT: Palette = { ...tokens.colors }
const DARK: Palette = { ...tokens.colorsDark }
export const palettes: Record<Scheme, Palette> = { light: LIGHT, dark: DARK }

/** The colours in use right now. Same object for the life of the app; its values change with the theme. */
export const colors: Palette = { ...LIGHT }

let scheme: Scheme = 'light'
let version = 0
let switchedAt = 0

export const currentScheme = (): Scheme => scheme
export const isDark = () => scheme === 'dark'

/** Makes `next` the palette in use. Returns true when that was a change. */
export function applyScheme(next: Scheme): boolean {
  if (next === scheme) return false
  scheme = next
  Object.assign(colors, palettes[next])
  version += 1
  switchedAt = Date.now()
  return true
}

/** True for a moment after the theme changed: screens are rebuilt then, and use this to put back what the person was doing. */
export const justSwitchedTheme = (withinMs = 3000) => switchedAt > 0 && Date.now() - switchedAt < withinMs

/**
 * A style object (or StyleSheet.create result, or any constant that uses `colors`) defined at the top of a file. It is rebuilt after the
 * theme changes, and behaves like the plain object: `styles.card`, spreads and style arrays all work. (`make` runs once when the file loads,
 * to learn the keys; it must not depend on anything that is not ready at import time. Values are read again whenever the theme changed.)
 */
export function themed<T extends object>(make: () => T): T {
  let built: T = make()
  let builtFor = version
  const current = (): T => {
    if (builtFor !== version) {
      built = make()
      builtFor = version
    }
    return built
  }
  // A plain object of getters, sealed. It must NOT be a Proxy: these objects are handed to components as `style`, and in development React
  // Native runs deepFreezeAndThrowOnMutationInDev over a component's props, which redefines every property of an object it is given. On a
  // Proxy over an empty target that defines real properties on the target and then contradicts the Proxy's own descriptors
  // ("trap result is configurable but target property is non-configurable": the red screen on the phone). React Native leaves a sealed
  // object alone, and a getter-only property cannot be written to, so nothing is weakened: the protection simply has nothing to change.
  // The keys are those of the first build; a theme change only changes values.
  const live = {} as Record<PropertyKey, unknown>
  for (const key of Reflect.ownKeys(built)) {
    Object.defineProperty(live, key, { enumerable: true, configurable: false, get: () => Reflect.get(current(), key) })
  }
  return Object.seal(live) as T
}

const kept = new Map<string, unknown>()

/**
 * useState that survives a theme change (when the screens are rebuilt), and only then: it starts from `initial` every other time.
 * For small bits of "where the person was", like the open tab of a settings screen.
 */
export function useKeptState<S>(key: string, initial: S): [S, (next: S) => void] {
  const [value, setValue] = useState<S>(() => (justSwitchedTheme() && kept.has(key) ? (kept.get(key) as S) : initial))
  const latest = useRef(value)
  latest.current = value
  return [value, (next: S) => { kept.set(key, next); latest.current = next; setValue(next) }]
}

export const space = { ...tokens.space }
export const radius = { ...tokens.radius }
export const layout = { ...tokens.layout }
export const motion = { ...tokens.motion }

const style = (s: { size: number; line: number; weight: number; tracking: number }) => ({
  fontSize: s.size,
  lineHeight: s.line,
  fontWeight: String(s.weight) as '400' | '500' | '600',
  letterSpacing: +(s.tracking * s.size).toFixed(2),
})

/** Text styles. Each access reads the colour in use at that moment. */
export const type = {
  get display() { return { ...style(tokens.type.display), color: colors.ink } },
  get title() { return { ...style(tokens.type.title), color: colors.ink } },
  get heading() { return { ...style(tokens.type.heading), color: colors.ink } },
  get subheading() { return { ...style(tokens.type.subheading), color: colors.ink } },
  get body() { return { ...style(tokens.type.body), color: colors.ink } },
  get small() { return { ...style(tokens.type.small), color: colors.muted } },
  get caption() { return { ...style(tokens.type.caption), color: colors.subtle } },
  get label() { return { fontSize: 14, lineHeight: 20, fontWeight: '500' as const, color: colors.ink } },
}
