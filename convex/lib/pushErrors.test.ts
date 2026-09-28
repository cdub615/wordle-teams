import { WebPushError } from 'web-push'
import { describe, expect, test } from 'vitest'
import { safePushErrorLog } from './pushErrors.ts'

// A capability URL, not a real one — this repository is public. The only
// property of it that matters to these tests is that it is a distinctive
// string the helper must never let through.
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/do-not-leak-me'

// Headers/body shaped like what web-push actually passes: see
// web-push-lib.js:377-384, called with the raw response text and headers of a
// non-2xx reply.
const HEADERS = { 'content-type': 'text/plain' }
const BODY = 'InvalidRegistration'

const aWebPushError = () =>
  new WebPushError('Received unexpected response code', 410, HEADERS, BODY, ENDPOINT)

describe('safePushErrorLog', () => {
  test('keeps the status code and message off a real WebPushError', () => {
    expect(safePushErrorLog(aWebPushError())).toEqual({
      statusCode: 410,
      message: 'Received unexpected response code',
    })
  })

  // THE ONE THAT MATTERS. WebPushError sets `endpoint` as an own enumerable
  // property right alongside `statusCode`, so a helper that forwarded the
  // error wholesale — or even shallow-copied it — would carry the endpoint
  // through undetected by the assertion above, which only checks the fields it
  // expects to exist. This checks the actual serialized output for the
  // endpoint string appearing ANYWHERE, which a helper that returns the raw
  // error (or `{ ...error }`) fails immediately.
  test('the endpoint is not present anywhere in the result, serialized or not', () => {
    const result = safePushErrorLog(aWebPushError())
    expect(JSON.stringify(result)).not.toContain(ENDPOINT)
    expect(Object.values(result)).not.toContain(ENDPOINT)
  })

  // WebPushError sets SIX own enumerable properties (name, message,
  // statusCode, headers, body, endpoint). The two prior tests cover message,
  // statusCode and endpoint; this covers the remaining three the result must
  // not carry — `name` included, since it is as much "not statusCode or
  // message" as headers and body are.
  test('name, headers and body are also absent from the result', () => {
    const result = safePushErrorLog(aWebPushError())
    expect(JSON.stringify(result)).not.toContain(BODY)
    expect(result).not.toHaveProperty('name')
    expect(result).not.toHaveProperty('headers')
    expect(result).not.toHaveProperty('body')
  })

  test('a non-Error thrown value does not throw the helper itself', () => {
    expect(safePushErrorLog('a rejected string')).toEqual({
      statusCode: undefined,
      message: 'a rejected string',
    })
  })

  test('an Error with no statusCode reports statusCode as undefined, not a guess', () => {
    expect(safePushErrorLog(new Error('network blip'))).toEqual({
      statusCode: undefined,
      message: 'network blip',
    })
  })

  // THE NARROWING ITSELF, pinned. Without `typeof statusCode === 'number'`,
  // a stringly-typed '410' would pass through as a truthy, non-number
  // statusCode — and at the pushSend.ts call site that skips the 404/410
  // delete branch (`statusCode === 404 || statusCode === 410` is false for
  // the string '410'), so the dead subscription is "successfully" retried
  // forever instead of being removed. See pushSend.ts's own comment on this.
  test('a non-numeric statusCode is reported as undefined, not passed through', () => {
    const error = Object.assign(new Error('odd shape'), { statusCode: '410' })
    expect(safePushErrorLog(error)).toEqual({
      statusCode: undefined,
      message: 'odd shape',
    })
  })
})
