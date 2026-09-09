/**
 * Build-time constants substituted by Vite's `define` (see vite.config.ts).
 * Not `import.meta.env`: these are computed during the build rather than read
 * from a .env file, and `define` is the mechanism Vite documents for that.
 */

/** The deployed commit SHA, or null where the build had no git available. */
declare const __SENTRY_RELEASE__: string | null
