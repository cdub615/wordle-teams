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
