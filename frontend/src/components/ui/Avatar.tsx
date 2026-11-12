import { AVATAR_LIGHTNESS, AVATAR_SATURATION, hashHue, initials } from '../../lib/initials'

/**
 * A round picture for a person. People do not upload photos, so the picture is their initials on a colour that is the same
 * every time for the same name (so someone looks familiar from one visit to the next).
 */
export function Avatar({ name, size = 44, className }: { name: string; size?: number; className?: string }) {
  const hue = hashHue(name)
  return (
    // The initials are drawn by CSS from data-initials, not as text, so they never become part of the accessible name of a button
    // that contains the avatar (a name that omits visible text fails WCAG 2.5.3 "Label in Name").
    <span
      aria-hidden
      data-initials={initials(name)}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white before:content-[attr(data-initials)] ${className ?? ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), backgroundColor: `hsl(${hue} ${AVATAR_SATURATION}% ${AVATAR_LIGHTNESS}%)` }}
    />
  )
}
