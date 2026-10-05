// @vitest-environment jsdom
//
// jsdom for the reasons use-pending-invite.hook.test.ts gives: these hooks are
// driven through renderHook, and they read window.location and sessionStorage.
//
// WHAT THIS FILE OWNS. pending-challenge.test.ts owns the store mechanics (the
// round trip, the clear-on-read, the throw-safety). This file owns the two
// DECISIONS made with them: when the challenge page stashes or clears
// (useChallengeArrival), and when the dashboard sends a player back there
// (usePendingChallenge) — plus the local day the claim is made with.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { codeOf } from '#/test-support/source-ast.ts'
import { PENDING_CHALLENGE_KEY, rememberPendingChallenge } from './pending-challenge.ts'
import { PENDING_INVITE_KEY, takePendingInvite, rememberPendingInvite } from './pending-invite.ts'
import { usePendingInvite } from './use-pending-invite.ts'
import {
  challengeClaimArgs,
  useChallengeArrival,
  usePendingChallenge,
} from './use-pending-challenge.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  sessionStorage.clear()
  window.history.replaceState({}, '', '/app')
})

const stashed = () => sessionStorage.getItem(PENDING_CHALLENGE_KEY)

// ───────────────────────── the challenge page's arrival ─────────────────────────

type Arrival = Parameters<typeof useChallengeArrival>[0]

const arrive = (props: Omit<Arrival, 'go'>) => {
  const go = vi.fn()
  const hook = renderHook((p: Omit<Arrival, 'go'>) => useChallengeArrival({ ...p, go }), {
    initialProps: props,
  })
  return { go, ...hook }
}

describe('useChallengeArrival', () => {
  test('signed out: stashes the token and sends them to sign in', () => {
    const { go } = arrive({ token: 'tok', isAuthenticated: false, needsProfile: undefined })
    expect(stashed()).toBe('tok')
    expect(go.mock.calls).toEqual([['/login']])
  })

  test('signed in with no player row: stashes, and sends them to /app for /complete-profile', () => {
    // /app's guard drops search params on its way to /complete-profile; the
    // stash is the carrier that survives, and the resume brings them back.
    const { go } = arrive({ token: 'tok', isAuthenticated: true, needsProfile: true })
    expect(stashed()).toBe('tok')
    expect(go.mock.calls).toEqual([['/app']])
  })

  test('a player who leaves /challenge reaches /app: their arrival leaves the stash EMPTY', () => {
    // THE TRAP THIS ROW EXISTS FOR. /app forwards a stashed challenge token
    // back here rather than spending it, so a stash left behind for a player
    // sends them here on every dashboard visit for the life of the tab — and a
    // player with no team, sent to /app to make one, is sent straight back.
    // A stash from their own signed-out trip is cleared too: it has done its job.
    rememberPendingChallenge('from-the-trip')
    const { go } = arrive({ token: 'tok', isAuthenticated: true, needsProfile: false })
    expect(stashed()).toBeNull()
    expect(go).not.toHaveBeenCalled()
  })

  test('while the profile question is unanswered it does nothing, then acts on the answer', () => {
    rememberPendingChallenge('from-the-trip')
    const { go, rerender } = arrive({ token: 'tok', isAuthenticated: true, needsProfile: undefined })
    expect(stashed()).toBe('from-the-trip')
    expect(go).not.toHaveBeenCalled()
    rerender({ token: 'tok', isAuthenticated: true, needsProfile: false })
    expect(stashed()).toBeNull()
    expect(go).not.toHaveBeenCalled()
  })
})

// ───────────────────────── the dashboard's resume ─────────────────────────

const resumeAt = (url: string, joinParam?: string) => {
  window.history.replaceState({}, '', url)
  const seen: string[] = []
  const hook = renderHook(
    (join: string | undefined) => usePendingChallenge(join, false, (t) => seen.push(t)),
    { initialProps: joinParam },
  )
  return { seen, ...hook }
}

describe('usePendingChallenge', () => {
  test('hands over a stashed token, and nothing when there is none', () => {
    expect(resumeAt('/app').seen).toEqual([])
    cleanup()
    rememberPendingChallenge('tok')
    expect(resumeAt('/app').seen).toEqual(['tok'])
  })

  test('TAKES the token: the stash is empty after, so the dashboard cannot loop', () => {
    // A token still stashed after the forward is found again the next time the
    // dashboard mounts, and the player can never see it.
    rememberPendingChallenge('tok')
    const first = resumeAt('/app')
    expect(first.seen).toEqual(['tok'])
    expect(stashed()).toBeNull()
    first.unmount()
    expect(resumeAt('/app').seen).toEqual([])
  })

  test('stands aside while an invite is stashed, and keeps its own token', () => {
    rememberPendingChallenge('tok')
    rememberPendingInvite('invite')
    const { seen } = resumeAt('/app')
    expect(seen).toEqual([])
    expect(stashed()).toBe('tok')
    // A peek, not a take: the invite is still there for usePendingInvite.
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBe('invite')
  })

  test('stands aside while ?join= is in the address bar', () => {
    rememberPendingChallenge('tok')
    const { seen } = resumeAt('/app?join=invite', 'invite')
    expect(seen).toEqual([])
    expect(stashed()).toBe('tok')
  })

  test('declared before usePendingInvite, the invite goes first and the challenge follows', () => {
    // The order Dashboard calls them in. The invite is consumed on the first
    // pass and the challenge waits; when joinParam moves (useSearchSync drops
    // it), the challenge is forwarded — "invite first, then the challenge in
    // the same arrival", which the plan accepts.
    rememberPendingChallenge('tok')
    window.history.replaceState({}, '', '/app?join=invite')
    const order: string[] = []
    const { rerender } = renderHook(
      (join: string | undefined) => {
        usePendingChallenge(join, false, (t) => order.push(`challenge:${t}`))
        usePendingInvite(join, (t) => order.push(`invite:${t}`))
      },
      { initialProps: 'invite' as string | undefined },
    )
    expect(order).toEqual(['invite:invite'])
    rerender(undefined)
    expect(order).toEqual(['invite:invite', 'challenge:tok'])
  })

  // THE REACHABLE PATH, which the ?join= test above cannot see: both links
  // followed while signed out, so the invite arrives STASHED and joinParam is
  // undefined throughout. joinParam never changes; the consume's in-flight flag
  // is what brings the resume back, and it forwards only once that settles.
  test('a STASHED invite: stands aside, waits out the consume, then forwards in the same arrival', () => {
    rememberPendingChallenge('tok')
    rememberPendingInvite('invite')
    window.history.replaceState({}, '', '/app')
    const seen: string[] = []
    const { rerender } = renderHook(
      (busy: boolean) => usePendingChallenge(undefined, busy, (t) => seen.push(t)),
      { initialProps: false },
    )
    expect(seen).toEqual([]) // the invite is stashed
    takePendingInvite() // usePendingInvite takes it and starts consumeLink
    rerender(true)
    expect(seen).toEqual([]) // consume in flight
    rerender(false)
    expect(seen).toEqual(['tok']) // settled: forwarded, same arrival
    expect(stashed()).toBeNull()
  })

  test('routes/app.tsx calls it BEFORE usePendingInvite', () => {
    // The test above proves the order works; this pins that Dashboard uses it.
    // Swapped, usePendingInvite empties its stash first and the resume races
    // the consume. Dashboard is not exported, so the source is the artefact.
    // A path, not `new URL(…, import.meta.url)`: under jsdom the global URL is
    // jsdom's, and node:fs refuses it (team-boards.hook.test.ts hit the same).
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '../routes/app.tsx')
    const code = codeOf(readFileSync(path, 'utf8'))
    const challenge = code.indexOf('usePendingChallenge(joinParam')
    const invite = code.indexOf('usePendingInvite(joinParam')
    expect(challenge).toBeGreaterThan(-1)
    expect(invite).toBeGreaterThan(-1)
    expect(challenge).toBeLessThan(invite)
  })
})

// ───────────────────────── the claim's day ─────────────────────────

describe('challengeClaimArgs', () => {
  test("today is the viewer's LOCAL day, not UTC's", () => {
    // CI runs TZ=UTC, where the two agree and no zone can be staged. So the
    // instant is 23:30 UTC and the Date reports the local calendar of a viewer
    // an hour east: already the 6th. A UTC reading (toISOString, getUTC*)
    // still says the 5th.
    const now = new Date('2026-10-05T23:30:00Z')
    Object.assign(now, { getFullYear: () => 2026, getMonth: () => 9, getDate: () => 6 })
    expect(challengeClaimArgs('tok', 'team-a', now)).toEqual({
      token: 'tok',
      opponentTeamId: 'team-a',
      today: '2026-10-06',
    })
  })

  test('defaults to the current moment', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 5, 12))
    expect(challengeClaimArgs('tok', 'team-a').today).toBe('2026-10-05')
  })
})
