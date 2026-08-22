import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/**
 * THE CHOKE POINT ITSELF, not just the rule it applies.
 *
 * lib/e2e.test.ts proves `realRecipients` picks the right addresses. That is not
 * the same as proving email.ts acts on the answer: the branch that skips a send
 * with nobody left, and the rebuilding of `to`/`cc`/`bcc`, live in the wrapper.
 * If that inverted, every real email would stop going out and no unit test of
 * the predicate would notice — which is the failure this module exists to make
 * impossible (wordle-teams-sga).
 *
 * The Resend client is constructed at module scope from the environment, so each
 * case stubs the env and re-imports. The fake ctx only has to satisfy the one
 * thing the component does with it — `ctx.runMutation` — which is also the exact
 * observation we want: whether a send was enqueued at all.
 */
const E2E = 'e2e+abc@wordleteams.com'
const REAL = 'ada@example.test'
const OTHER = 'grace@example.test'

type Enqueued = { to?: Array<string>; cc?: Array<string>; bcc?: Array<string> }

function fakeCtx() {
  const calls: Array<Enqueued> = []
  return {
    calls,
    ctx: {
      runMutation: async (_ref: unknown, args: Enqueued) => {
        calls.push(args)
        return 'fake-email-id'
      },
    },
  }
}

async function load(e2eTestMode: string | undefined) {
  vi.resetModules()
  vi.stubEnv('RESEND_API_KEY', 're_test_key_not_a_real_credential')
  // Deleting the variable, not blanking it, so `load(undefined)` means what it
  // says. lib/e2e.test.ts pins the empty-string case separately.
  vi.stubEnv('E2E_TEST_MODE', e2eTestMode)
  return (await import('./email.ts')).sendEmail
}

const message = { from: 'Wordle Teams <auth@wordleteams.com>', subject: 's', text: 't' }

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllEnvs())

test('a real recipient is enqueued', async () => {
  const sendEmail = await load('true')
  const { ctx, calls } = fakeCtx()

  const id = await sendEmail(ctx as never, { ...message, to: REAL })

  expect(id).toBe('fake-email-id')
  expect(calls).toHaveLength(1)
  expect(calls[0]!.to).toEqual([REAL])
})

// The bug this whole module exists to stop, at the choke point rather than at
// the predicate: nothing must be enqueued, and the caller must be told so.
test('a throwaway recipient is not enqueued at all in test mode', async () => {
  const sendEmail = await load('true')
  const { ctx, calls } = fakeCtx()

  const id = await sendEmail(ctx as never, { ...message, to: E2E })

  expect(id).toBeNull()
  expect(calls).toEqual([])
})

// THE DANGEROUS DIRECTION. If the guard inverted, this is the case that would
// silently stop all real mail — and it is the one a predicate test cannot see.
test('the same throwaway recipient IS enqueued when the flag is off', async () => {
  const sendEmail = await load(undefined)
  const { ctx, calls } = fakeCtx()

  const id = await sendEmail(ctx as never, { ...message, to: E2E })

  expect(id).toBe('fake-email-id')
  expect(calls[0]!.to).toEqual([E2E])
})

test('a mixed batch is enqueued once, carrying only the real people', async () => {
  const sendEmail = await load('true')
  const { ctx, calls } = fakeCtx()

  await sendEmail(ctx as never, { ...message, to: [E2E, REAL, OTHER] })

  expect(calls).toHaveLength(1)
  expect(calls[0]!.to).toEqual([REAL, OTHER])
})

test('cc and bcc are filtered too, and a fully-suppressed field is omitted', async () => {
  const sendEmail = await load('true')
  const { ctx, calls } = fakeCtx()

  await sendEmail(ctx as never, { ...message, to: REAL, cc: [E2E, OTHER], bcc: [E2E] })

  expect(calls[0]!.cc).toEqual([OTHER])
  // Not [] — the component forwards an empty array to the Resend API rather
  // than omitting the field.
  expect(calls[0]!.bcc).toBeUndefined()
})

// AN EMPTY LIST FROM THE CALLER IS LOUD, suppression is quiet. Phase 6 builds
// its recipients from a query; a filter or index mistake that returns nothing
// must not look exactly like correct suppression — in the return value or in
// the mail oracle.
test('a caller-supplied empty recipient list throws rather than skipping quietly', async () => {
  const sendEmail = await load('true')
  const { ctx, calls } = fakeCtx()

  await expect(sendEmail(ctx as never, { ...message, to: [] })).rejects.toThrow(/no recipients/)
  expect(calls).toEqual([])
})

test('the empty-list throw does not depend on the flag', async () => {
  const sendEmail = await load(undefined)
  const { ctx } = fakeCtx()

  await expect(sendEmail(ctx as never, { ...message, to: [] })).rejects.toThrow(/no recipients/)
})

test('a send whose only real recipient is in cc still does not go out', async () => {
  // `to` is what decides. A message nobody was addressed to is not a message,
  // and quietly promoting a cc into the `to` line would be inventing intent.
  const sendEmail = await load('true')
  const { ctx, calls } = fakeCtx()

  const id = await sendEmail(ctx as never, { ...message, to: E2E, cc: REAL })

  expect(id).toBeNull()
  expect(calls).toEqual([])
})
