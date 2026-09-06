import { describe, expect, it } from 'vitest'
import { hidesSiteFooter } from './site-chrome.ts'

/**
 * MOVED HERE WITH THE FUNCTION, ASSERTION FOR ASSERTION. These four cases lived
 * in components/chat/use-chat-sync.test.ts while the predicate did; the move
 * out of the chat module is a bundling change (see site-chrome.ts) and must not
 * be a coverage change, so nothing here is new and nothing was dropped.
 */
describe('hidesSiteFooter', () => {
  it('suppresses the footer on the one route that lays itself out to the viewport', () => {
    expect(hidesSiteFooter('/chat')).toBe(true)
  })

  // `/chat/` and `/chat` are the same route; the trailing-slash spelling would
  // otherwise get the footer back, and the broken layout with it.
  it('suppresses it for the trailing-slash spelling of that route', () => {
    expect(hidesSiteFooter('/chat/')).toBe(true)
  })

  // EVERY OTHER ROUTE KEEPS IT, which is the half a wrong `startsWith` would
  // quietly break: the footer carries the only links to /privacy and /terms.
  it('leaves every other route alone', () => {
    for (const pathname of ['/', '/app', '/about', '/privacy', '/terms', '/team', '/login']) {
      expect(hidesSiteFooter(pathname), pathname).toBe(false)
    }
  })

  // NOT `startsWith('/chat')`. There is no nested chat route today, and a
  // hypothetical /chatter or /chat-settings would silently lose its footer.
  it('does not match a route that merely begins with the same letters', () => {
    expect(hidesSiteFooter('/chatter')).toBe(false)
    expect(hidesSiteFooter('/chat-settings')).toBe(false)
  })
})
