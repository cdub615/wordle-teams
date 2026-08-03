// Titles, ported 1:1 from the v1 app's Next.js metadata (src/app/layout.tsx).
// Next applies `template` automatically to any nested page title; TanStack has
// no equivalent, so pageTitle() does the interpolation explicitly and each
// route calls it.
export const APP_NAME = 'Wordle Teams'
export const APP_DEFAULT_TITLE = 'Wordle Teams: The ultimate app for Wordle enthusiasts'
const APP_TITLE_TEMPLATE = '%s - Wordle Teams'

/** A page title in the v1 house style: pageTitle('Dashboard') -> 'Dashboard - Wordle Teams'. */
export function pageTitle(segment?: string) {
  return segment ? APP_TITLE_TEMPLATE.replace('%s', segment) : APP_DEFAULT_TITLE
}
