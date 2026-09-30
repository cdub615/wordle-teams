import { captureError } from './sentry-capture'

// Wraps a TanStack Start server route handler so its failures are reported.
//
// Server handlers sit OUTSIDE the router's error boundaries, so the root
// onCatch never sees them. Proven on beta: a throw in a server handler returned
// 404 with no Sentry event, exactly like the loader case. See wordle-teams-7qa.
//
// The error is re-thrown after reporting. Reporting is an observation, not a
// recovery — swallowing it here would change behaviour the framework already
// defines, and would hide the failure from the caller instead of just from us.

type Handler<TArgs extends unknown[]> = (...args: TArgs) => Response | Promise<Response>

export function withErrorCapture<TArgs extends unknown[]>(
  route: string,
  handler: Handler<TArgs>,
): Handler<TArgs> {
  return async (...args: TArgs) => {
    try {
      return await handler(...args)
    } catch (error) {
      captureError(error, { route, kind: 'server-handler' })
      throw error
    }
  }
}
