// Shared Sentry tuning. The client (@sentry/tanstackstart-react, initialised in
// router.tsx) and the worker (@sentry/cloudflare, initialised in server.ts) are
// separate SDKs with separate init calls, but they should sample at the same
// rate — otherwise a single request produces a client trace and no server trace,
// or vice versa, and the waterfall has holes in it. One constant, two callers.
export const TRACES_SAMPLE_RATE = 0.2
