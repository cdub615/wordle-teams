const { withAxiom } = require('next-axiom')
const { withSentryConfig } = require('@sentry/nextjs')
const { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } = require('next/constants')

const sentryOptions = {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "christian-white",
  project: "wordle-teams",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,
}

/** @type {(phase: string, defaultConfig: import("next").NextConfig) => Promise<import("next").NextConfig>} */
module.exports = async (phase) => {
  /** @type {import("next").NextConfig} */
  const nextConfig = withAxiom({})

  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_BUILD) {
    const withSerwist = (await import('@serwist/next')).default({
      disable: process.env.NODE_ENV !== "production",
      swSrc: 'src/app/sw.ts',
      swDest: 'public/sw.js',
      // Serwist injects its own client-side registration by default, which ran in
      // addition to src/components/service-worker-registration.tsx — verified in
      // production: navigator.serviceWorker.register() was called twice on every
      // page load, once from @serwist/window and once from our own component.
      // Serwist's call has no rejection handler, so a failed registration surfaced
      // as an unhandled promise rejection (Sentry 7481850095). We keep our own
      // component, which handles the failure, and register once.
      register: false,
    })
    return withSentryConfig(withSerwist(nextConfig), sentryOptions)
  }

  return withSentryConfig(nextConfig, sentryOptions)
}

