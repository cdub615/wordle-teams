import { createFileRoute, redirect } from '@tanstack/react-router'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useSuspenseQuery, useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { authClient } from '#/lib/auth-client'
import { pageTitle } from '#/lib/seo'
import { SIGNIN_PARAM, trackFunnel } from '#/lib/funnel.ts'

export const Route = createFileRoute('/')({
  // v1: src/app/me/page.tsx metadata.title. The signed-in landing page is /me
  // there and / here, so the title follows the screen rather than the path.
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }] }),
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.status.get, {}))
    await context.queryClient.ensureQueryData(convexQuery(api.auth.getCurrentUser, {}))
    await context.queryClient.ensureQueryData(convexQuery(api.me.myData, {}))
  },
  component: Home,
})

function Home() {
  const { data: message } = useSuspenseQuery(convexQuery(api.status.get, {}))
  const { data: user } = useSuspenseQuery(convexQuery(api.auth.getCurrentUser, {}))
  const { data: mine } = useSuspenseQuery(convexQuery(api.me.myData, {}))
  const [draft, setDraft] = useState('')
  const setMessage = useMutation({ mutationFn: useConvexMutation(api.status.set) })

  // Bottom of the login funnel (wt-ksh.12.7). Reaching here authenticated is the
  // only reliable "they made it" signal: the OAuth round-trip finishes as a fresh
  // document load, so nothing on /login survives to observe it. The marker is
  // stripped from the URL immediately so a refresh or a share cannot double-count.
  useEffect(() => {
    const url = new URL(window.location.href)
    const method = url.searchParams.get(SIGNIN_PARAM)
    if (method !== 'oauth' && method !== 'otp') return
    trackFunnel({ name: 'login_callback_arrived', method })
    url.searchParams.delete(SIGNIN_PARAM)
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  }, [])

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>wordle-teams v2 walking skeleton</h1>
      <p data-testid="signed-in-email">Signed in as {user?.email}</p>
      <button
        onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => location.reload() } })}
      >
        Sign out
      </button>
      {/* Phase 1's done-when is only checkable if copied data is visible: a
          copied account has to look different from a brand new one. Deliberately
          plain — the real scoreboard is Phase 2. */}
      <section data-testid="copied-data" aria-labelledby="mine-heading">
        <h2 id="mine-heading">Your copied data</h2>
        {mine === null ? (
          <p>Not signed in.</p>
        ) : !mine.matched ? (
          <p data-testid="no-player">
            No copied player matches this account. Either this address was not in
            the copied scope, or a social login resolved to a different user than
            the one the copy created.
          </p>
        ) : (
          <>
            <p data-testid="player-name">
              Player: <strong>{[mine.firstName, mine.lastName].filter(Boolean).join(' ') || '(no name)'}</strong>
            </p>
            <p data-testid="score-count">
              Board entries: <strong>{mine.scoreCount}</strong>
              {mine.latestPuzzleDay ? <> · latest puzzle day {mine.latestPuzzleDay}</> : null}
            </p>
            <p>
              Teams (<span data-testid="team-count">{mine.teams.length}</span>):
            </p>
            <ul data-testid="team-list">
              {mine.teams.map((t) => (
                <li key={t.id}>
                  {t.name} — {t.playerCount} player{t.playerCount === 1 ? '' : 's'}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <p data-testid="status-message">
        Status from Convex: <strong>{message ?? '(none yet)'}</strong>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setMessage.mutate({ message: draft })
          setDraft('')
        }}
      >
        <label htmlFor="status">New status</label>{' '}
        <input id="status" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit">Save</button>
      </form>
    </main>
  )
}
