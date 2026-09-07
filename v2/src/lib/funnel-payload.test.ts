import { describe, expect, test } from 'vitest'
import { toLogSnagPayload } from './funnel-payload.ts'

// /api/funnel is public and unauthenticated, so these allowlists are the only
// thing stopping it being an open relay into the project's LogSnag.

describe('toLogSnagPayload', () => {
  test('maps each known event to its LogSnag name', () => {
    expect(toLogSnagPayload({ name: 'login_view' }, 'beta')?.event).toBe('Login viewed')
    expect(toLogSnagPayload({ name: 'login_code_requested' }, 'beta')?.event).toBe(
      'Login code requested',
    )
    expect(toLogSnagPayload({ name: 'login_callback_arrived' }, 'beta')?.event).toBe(
      'Login completed',
    )
  })

  test('rejects an unknown event name', () => {
    expect(toLogSnagPayload({ name: 'totally_made_up' }, 'beta')).toBeNull()
    expect(toLogSnagPayload({ name: '__proto__' }, 'beta')).toBeNull()
  })

  test('rejects a body with no name, and non-objects', () => {
    expect(toLogSnagPayload({ provider: 'google' }, 'beta')).toBeNull()
    expect(toLogSnagPayload(null, 'beta')).toBeNull()
    expect(toLogSnagPayload('login_view', 'beta')).toBeNull()
    expect(toLogSnagPayload(42, 'beta')).toBeNull()
  })

  test('keeps a known provider and drops an unknown one', () => {
    expect(
      toLogSnagPayload({ name: 'login_provider_click', provider: 'github' }, 'beta')?.tags,
    ).toEqual({ env: 'beta', provider: 'github' })
    expect(
      toLogSnagPayload({ name: 'login_provider_click', provider: 'evilcorp' }, 'beta')?.tags,
    ).toEqual({ env: 'beta' })
  })

  test('keeps a known method and drops an unknown one', () => {
    expect(
      toLogSnagPayload({ name: 'login_callback_arrived', method: 'oauth' }, 'beta')?.tags,
    ).toEqual({ env: 'beta', method: 'oauth' })
    expect(
      toLogSnagPayload({ name: 'login_callback_arrived', method: 'sneaky' }, 'beta')?.tags,
    ).toEqual({ env: 'beta' })
  })

  test('never forwards arbitrary tags, and never PII', () => {
    const tags = toLogSnagPayload(
      {
        name: 'login_view',
        email: 'someone@example.com',
        userId: 'abc123',
        tags: { injected: 'yes' },
        provider: { toString: () => 'google' },
      },
      'beta',
    )?.tags
    expect(tags).toEqual({ env: 'beta' })
    expect(JSON.stringify(tags)).not.toContain('example.com')
  })

  test('env is passed through to the tag', () => {
    expect(toLogSnagPayload({ name: 'login_view' }, 'production')?.tags.env).toBe('production')
  })
})

describe('onboarding events', () => {
  test('onboarding_view carries the incomplete task set', () => {
    const payload = toLogSnagPayload({ name: 'onboarding_view', tasks: 'board,team' }, 'beta')
    expect(payload?.event).toBe('Onboarding viewed')
    expect(payload?.tags.tasks).toBe('board,team')
    expect(payload?.tags.env).toBe('beta')
  })

  test('onboarding_task_click carries the task', () => {
    const payload = toLogSnagPayload({ name: 'onboarding_task_click', task: 'invite' }, 'prod')
    expect(payload?.event).toBe('Onboarding task clicked')
    expect(payload?.tags.task).toBe('invite')
  })

  test('onboarding_complete and onboarding_dismiss are allowed', () => {
    expect(toLogSnagPayload({ name: 'onboarding_complete' }, 'beta')?.event).toBe(
      'Onboarding complete',
    )
    expect(toLogSnagPayload({ name: 'onboarding_dismiss' }, 'beta')?.event).toBe(
      'Onboarding dismissed',
    )
  })

  test('an unknown task id is dropped, not passed through', () => {
    // /api/funnel is public and unauthenticated. Tags are BUILT from
    // allowlists, never forwarded, or anyone could write arbitrary tags into
    // the project's LogSnag.
    const payload = toLogSnagPayload({ name: 'onboarding_task_click', task: 'evil' }, 'beta')
    expect(payload).not.toBeNull()
    expect(payload?.tags.task).toBeUndefined()
  })

  test('unknown ids inside a task set are filtered out', () => {
    const payload = toLogSnagPayload({ name: 'onboarding_view', tasks: 'board,evil' }, 'beta')
    expect(payload?.tags.tasks).toBe('board')
  })

  test('a task set of only unknown ids sets no tag at all', () => {
    const payload = toLogSnagPayload({ name: 'onboarding_view', tasks: 'evil,worse' }, 'beta')
    expect(payload?.tags.tasks).toBeUndefined()
  })

  test('a repeated id cannot inflate the tag', () => {
    const payload = toLogSnagPayload(
      { name: 'onboarding_view', tasks: 'board,'.repeat(1000) },
      'beta',
    )
    expect(payload?.tags.tasks).toBe('board')
  })

  test('prototype-chain keys are not allowlisted values', () => {
    for (const hostile of ['__proto__', 'constructor', 'toString', 'valueOf']) {
      expect(
        toLogSnagPayload({ name: 'onboarding_task_click', task: hostile }, 'beta')?.tags.task,
      ).toBeUndefined()
      expect(
        toLogSnagPayload({ name: 'onboarding_view', tasks: hostile }, 'beta')?.tags.tasks,
      ).toBeUndefined()
      expect(
        toLogSnagPayload({ name: 'login_provider_click', provider: hostile }, 'beta')?.tags
          .provider,
      ).toBeUndefined()
      expect(
        toLogSnagPayload({ name: 'login_callback_arrived', method: hostile }, 'beta')?.tags
          .method,
      ).toBeUndefined()
    }
  })
})
