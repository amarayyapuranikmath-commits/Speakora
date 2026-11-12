export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? Array.from(words[0]).slice(0, 2) : [Array.from(words[0])[0], Array.from(words[words.length - 1])[0]]
  return letters.join('').toUpperCase()
}

/** Saturation and lightness of every avatar colour. Lightness 30% keeps white initials at 5.4:1 or better for EVERY hue (see the test). */
export const AVATAR_SATURATION = 42
export const AVATAR_LIGHTNESS = 30

export function hashHue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360
  return h
}
