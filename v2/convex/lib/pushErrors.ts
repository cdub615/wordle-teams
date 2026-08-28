/**
 * Reduces a thrown push-delivery error to the fields that are safe to log.
 *
 * `web-push`'s `WebPushError` (src/web-push-error.js) sets SIX own enumerable
 * properties: `name`, `message`, `statusCode`, `headers`, `body` — and
 * `endpoint`. That last one is a capability URL: anyone holding it can push to
 * that device. A logger, or `JSON.stringify`, prints an Error's own enumerable
 * properties without being asked to, so passing the raw error to
 * `console.error` leaks it regardless of what the surrounding code intended.
 * This function is the one place in the push-delivery path allowed to read a
 * thrown error, and it returns exactly two fields — `statusCode` and
 * `message` — never touching `endpoint`, `headers` or `body`, so nothing it
 * returns can carry the endpoint even by accident.
 *
 * DEPENDENCY-FREE, like every other module in convex/lib/ — no Convex, no
 * network, no env, no I/O, not even `web-push` itself. `WebPushError` is a
 * plain constructor with no exotic prototype behaviour, so reading two fields
 * off it needs nothing beyond `instanceof Error`.
 *
 * `message` IS NOT A FIXED STRING, and this function does not treat it as one.
 * `WebPushError`'s is always `'Received unexpected response code'`, but
 * `sendNotification` also rejects with plain `Error`s from request validation,
 * from VAPID header generation, and from a socket timeout or a raw socket
 * error re-thrown as-is (web-push-lib.js, several call sites; vapid-helper.js).
 * The worst of those CAN carry endpoint-derived text: `getVapidHeaders`
 * computes its `audience` from `subscription.endpoint`
 * (web-push-lib.js:274-276) and, if that somehow fails to parse as a URL,
 * throws `'VAPID audience is not a url. ' + audience` (vapid-helper.js:200) —
 * but `audience` is the endpoint's ORIGIN (e.g. `https://fcm.googleapis.com`),
 * not its path, because `web-push-lib.js:274` builds it from only
 * `parsedUrl.protocol` and `parsedUrl.host`. An origin is not the capability;
 * the path after it is. That is the actual, checked reason `message` is kept
 * here while `body` and `headers` are not: the worst it can leak is which push
 * service a deployment uses, not which device.
 */
export type SafePushErrorLog = { statusCode: number | undefined; message: string }

export function safePushErrorLog(error: unknown): SafePushErrorLog {
  if (error instanceof Error) {
    // Read narrowly rather than trusting the type: `error` is `unknown` at the
    // call site, and this function's whole job is to not assume more about the
    // thrown value than it actually has.
    const statusCode = (error as { statusCode?: unknown }).statusCode
    return {
      statusCode: typeof statusCode === 'number' ? statusCode : undefined,
      message: error.message,
    }
  }
  return { statusCode: undefined, message: String(error) }
}
