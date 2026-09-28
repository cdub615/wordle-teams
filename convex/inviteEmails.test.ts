import { describe, expect, test } from 'vitest'
import { teamInviteEmail } from './inviteEmails'

/**
 * THE INVITE EMAIL SIGNS ITSELF WITH THE DEPLOYMENT THAT SENT IT.
 *
 * WHY THIS EXISTS. The plain-text signature block carried a literal
 * `https://wordleteams.com` regardless of deployment, so a beta invite told its
 * recipient the mail came from production (`wordle-teams-vmya`). It was the only
 * hardcoded origin in the file — the sign-in link one line above it and the
 * whole HTML half already derived theirs — which is exactly the shape that
 * survives review: one line disagreeing with its neighbours.
 *
 * There was no test file for this module at all, which is the other half of why
 * it survived.
 */
const email = (signInUrl: string) =>
  teamInviteEmail({ teamName: 'The Dub Club', inviterName: 'Ada', signInUrl })

describe('the text signature names the deployment that sent the mail', () => {
  test('a beta invite signs itself with beta', () => {
    const { text } = email('https://beta.wordleteams.com/login?email=x%40example.com')
    expect(text).toContain('https://beta.wordleteams.com')
    // THE ASSERTION THAT WOULD HAVE CAUGHT IT. Presence of the right origin is
    // not enough — the bug was the WRONG one being present as well.
    expect(text).not.toContain('https://wordleteams.com')
  })

  test('a production invite signs itself with production', () => {
    const { text } = email('https://wordleteams.com/login?email=x%40example.com')
    expect(text).toContain('https://wordleteams.com')
  })

  test('the signature and the sign-in link agree about the origin', () => {
    // The property that matters, stated directly: two lines of one email must
    // not name two different deployments. Reading the origin off signInUrl
    // rather than re-reading SITE_URL is what makes this structural.
    const signInUrl = 'https://beta.wordleteams.com/login?email=x%40example.com'
    const { text } = email(signInUrl)
    const origins = [...text.matchAll(/https?:\/\/[^\s/]+/g)].map((m) => m[0])
    expect(new Set(origins).size, `two origins in one email: ${origins.join(', ')}`).toBe(1)
  })

  test('a signInUrl that will not parse falls back rather than throwing', () => {
    // The template runs INSIDE the invite transaction, and the module doc
    // records that a throw here rolls back an invite that already succeeded.
    // So a broken URL must degrade, never explode.
    expect(() => email('not a url')).not.toThrow()
    expect(email('not a url').text).toContain('https://wordleteams.com')
  })
})
