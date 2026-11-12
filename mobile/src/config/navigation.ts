/**
 * The six main sections, in order: the tabs of the bottom bar (Android) mirror the tabs of the top bar on the website.
 *
 * A tab is shown only when its section is `ready` (built and verified), so the navigation never advertises something that does not
 * exist. Debug builds preview the unbuilt tabs (they open a screen that says plainly the section is not available yet) so the
 * design can be reviewed; release builds never show them. Flip `ready` to true in the phase that delivers the section.
 */
export interface Tab {
  id: 'Home' | 'Talk' | 'Learn' | 'Coach' | 'Friends' | 'Progress'
  label: string
  ready: boolean
}

export const TABS: Tab[] = [
  { id: 'Home', label: 'Home', ready: true },
  { id: 'Talk', label: 'Talk', ready: true },
  { id: 'Learn', label: 'Learn', ready: true },
  { id: 'Coach', label: 'AI Coach', ready: true },
  { id: 'Friends', label: 'Friends', ready: true },
  { id: 'Progress', label: 'Progress', ready: true },
]

export const SHOW_UNBUILT_TABS = __DEV__

export function visibleTabs(preview: boolean = SHOW_UNBUILT_TABS): Tab[] {
  return TABS.filter((t) => t.ready || preview)
}
