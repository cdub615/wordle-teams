import * as Sentry from '@sentry/nextjs'

// export function register() {
//   if (process.env.NEXT_RUNTIME === 'nodejs') {
//     Sentry.init({
//       // Adjust this value in production, or use tracesSampler for greater control
//       tracesSampleRate: 1.0,

//       // Setting this option to true will print useful information to the console while you're setting up Sentry.
//       debug: false,
//     })
//   }

//   if (process.env.NEXT_RUNTIME === 'edge') {
//     Sentry.init({
//       // Adjust this value in production, or use tracesSampler for greater control
//       tracesSampleRate: 1.0,

//       // Setting this option to true will print useful information to the console while you're setting up Sentry.
//       debug: false,
//     })
//   }
// }



export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
