/**
 * Build-time constants substituted by Vite's `define` (see vite.config.ts).
 * Not `import.meta.env`: these are computed during the build rather than read
 * from a .env file, and `define` is the mechanism Vite documents for that.
 */

/** The deployed commit SHA, or null where the build had no git available. */
declare const __SENTRY_RELEASE__: string | null

/**
 * The calendar year the bundle was built in, for Footer.tsx's copyright line.
 * A constant rather than a render-time clock read so the SSR pass and the
 * hydration pass cannot disagree across midnight on 31 December — see the
 * comment at its one call site and wordle-teams-56ag.
 */
declare const __BUILD_YEAR__: number
