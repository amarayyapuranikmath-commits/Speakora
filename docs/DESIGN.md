# Design system

One restrained, professional look across the website and the Android app. This document is the rulebook; the code enforces what it can.

## Principles

1. **No sidebar, anywhere.** The website uses a horizontal tab bar at the top; Android uses a native bottom tab bar.
2. **Six main sections:** Home, Talk, Learn, AI Coach, Friends, Progress. Settings and Sign out live behind the small profile control, not in the tabs.
3. **Only real sections appear.** (Learn, Friends and AI Coach are now built and shown; the mechanism stays for future sections.) A tab is shown only when its section is built and verified (`ready` in `frontend/src/config/navigation.ts` and `mobile/src/config/navigation.ts`). Unbuilt sections can be previewed for design review (web: `VITE_SHOW_UNBUILT_TABS=1`; Android: debug builds) and then open a page that says plainly they are not available yet. Flip `ready` in the phase that delivers the section.
4. **Home is minimal:** a welcome, today's goal with one button, and one line of real progress. No statistics grid, charts, feeds or repeated information. Nothing is shown that is not a recorded result.
5. **Single column by default.** Learning content and landing sections are one column in a narrow reading width (`max-w-reading`, 640 px). Use two columns only for a real usability reason.
6. **Restraint:** one deep-green accent on warm neutrals, small radii (8 / 12 px), borders instead of shadows, one overlay shadow for menus and dialogs, short subtle motion that respects `prefers-reduced-motion`.
7. **Never claim what does not exist:** no invented statistics, counts, ratings, testimonials, or features. Marketing copy describes only what is built and verified.

## Tokens

`design/tokens.json` is the single source of truth. Run `node design/build-tokens.cjs` after editing it; that regenerates `frontend/src/design/tokens.css` (imported by `index.css`) and `mobile/src/ui/tokens.generated.ts` (re-exported by `mobile/src/ui/theme.ts`). Never edit the generated files; a test fails if they are out of date.

| Group | Tokens |
|---|---|
| Colour | canvas, surface, ink, muted, subtle, line, lineStrong, **field** (input borders, 3:1), accent, accentHover, accentSoft, danger / warning / success (+ soft) |
| Type | display 56/62, title 28/34, heading 20/28, subheading 16/24, body 16/26, small 14/20, caption 12/16 (Tailwind: `text-display`, `text-title`, ...) |
| Radius | control 8, panel 12, pill |
| Layout | reading 640, app 1024, gutter 20 |
| Motion | fast 120 ms, base 200 ms, slow 320 ms, one easing curve |

Accessibility is tested, not assumed: every text/background pair meets WCAG AA (4.5:1), input borders and the focus ring meet 3:1, and white avatar initials are readable on **every** possible avatar hue.

## Navigation behaviour

- **Website:** `layouts/TopTabs.tsx`. From 1024 px the tabs sit beside the logo (icon and label side by side). Below that they form their own row under the header, sharing the width equally with the icon above the label, so all six are always visible and nothing scrolls sideways (the layout was audited at 375, 768 and 1280 px with all six tabs). The current tab has an underline and `aria-current="page"`. Sub-pages stay inside their section (Previous partners, Call history and Topics belong to Talk).
- **Profile control:** `layouts/ProfileMenu.tsx` (web) and `navigation/ProfileMenu.tsx` (Android). Keyboard operable, Escape closes, focus returns to the button.
- **Android:** `navigation/index.tsx` with a slim `AppHeader` (brand left, profile right). Previous partners, Topics and Call history are screens pushed above the tabs and reached from Talk.

## Accessibility notes

- Avatars draw their initials with CSS (`data-initials`), so a button around an avatar keeps a clean accessible name ("Label in Name", WCAG 2.5.3).
- Body text never goes below 16 px; touch targets on Android are at least 48 dp tall.

## Learn and Friends screens

- **Learn** is a series of single-column screens, never one crowded page: subject choice, levels, lessons, then a lesson with three sections (Learn, Practice, Test) shown one at a time. Progress bars are plain and each shows real counts.
- **Friends** lists requests first, then friends with online state; unread counts are a separate badge next to the Message link so link text and accessible name match.
- The accessibility audit (`frontend/e2e/audit.spec.ts`) covers these pages at three widths.
