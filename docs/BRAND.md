# Speakora brand

The product is called **Speakora** (it was "English Speaking Partner"). The name is configurable (`APP_NAME` for the backend and the emails, `VITE_APP_NAME`
for the website) and is also set in `mobile/src/config.ts` and the Android `app_name` string.

## The mark

A speech bubble holding an **S** made of two stacked circular arcs: two voices, one conversation. Flat colour, no gradients.

| Colour | Value | Used for |
|---|---|---|
| Deep navy | `#0B1F4B` | the bubble, the wordmark, the email header, the launch screen, `theme-color` |
| Vivid blue (mark) | `#2F6BFF` | the lower bowl of the S |
| Brand blue (interface) | `#1D4ED8` (`accent` in `design/tokens.json`) | buttons, links, focus and selection on the website and in the app; white text on it passes WCAG AA |
| White | `#FFFFFF` | the S on the navy bubble; the bubble on dark backgrounds |

The interface palette (canvas, ink, lines) is unchanged. Only the accent moved from green to blue, in one place (`design/tokens.json`, then
`node design/build-tokens.cjs`), so the website and the app cannot drift apart.

## Files (`design/logo/`)

| File | Use |
|---|---|
| `speakora-logo.svg` | primary horizontal logo (mark and wordmark) for light backgrounds |
| `speakora-logo-dark.svg` | the same for navy and other dark backgrounds |
| `speakora-logo-mono-navy.svg`, `speakora-logo-mono-white.svg` | one colour (the S is cut out, so any background shows through) |
| `speakora-symbol.svg`, `-dark`, `-mono-navy`, `-mono-white` | the standalone S-in-a-bubble symbol in each version |
| `speakora-app-icon.svg`, `speakora-app-icon-square.svg` | navy tile with the mark: favicon, website icons, launcher |
| `speakora-splash.svg` | stacked logo for the Android launch screen |
| `speakora-og.svg` | social-sharing card (the tagline is live text, so it is rendered to a PNG) |

The wordmark is Inter Bold (SIL Open Font License) converted to outlines, so the files do not depend on an installed font.
Keep clear space of at least the height of the S around the mark, and do not use the mark smaller than 16 px.

## Where it is used

- **Website:** `frontend/src/components/ui/Logo.tsx` (header, footer, sign-in, onboarding), `frontend/public/favicon.svg`, `favicon-32.png`,
  `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `og-image.png`, `site.webmanifest`, and the metadata in `frontend/index.html`.
- **Android:** `mobile/src/ui/BrandMark.tsx` (welcome, sign-in, sign-up, verification and reset screens); the launcher icon (an adaptive icon in
  `res/mipmap-anydpi-v26`, `res/drawable/ic_launcher_foreground.xml`, `res/values/ic_launcher_background.xml`, plus PNGs for older phones in
  `res/mipmap-*`); the launch screen (`res/drawable/splash_background.xml`, `res/drawable-nodpi/splash_logo.png`, the `Theme.App.Splash` style and,
  on Android 12 and later, `res/values-v31/styles.xml`). The package name (`com.englishspeakingmobile`), the registered component name
  (`EnglishSpeakingMobile`) and the secure-storage key are internal identifiers and were **not** renamed, so updates and existing sign-ins keep working.
- **Emails:** the sender name is `APP_NAME`; the layout uses navy for the header and blue for the code, the button and links.
  Emails carry the name as text, not the logo image (a mail client cannot show an image that is not hosted at a public address).

## Regenerating

```
pip install fonttools brotli          # once
python design/build-logo.py            # SVGs, the Android vector icon, adaptive-icon XML, favicon.svg
node design/build-icons.cjs            # PNGs (website icons, Open Graph card, Android launcher and splash)
node design/build-tokens.cjs           # colours, after editing design/tokens.json
```

The Open Graph and Twitter image tags use a relative path (`/og-image.png`); some crawlers want an absolute address, which depends on where the site is hosted.
