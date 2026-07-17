import { createFileRoute, redirect } from '@tanstack/react-router'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useSuspenseQuery, useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.status.get, {}))
    await context.queryClient.ensureQueryData(convexQuery(api.auth.getCurrentUser, {}))
  },
  component: Home,
})

function Home() {
  const { data: message } = useSuspenseQuery(convexQuery(api.status.get, {}))
  const { data: user } = useSuspenseQuery(convexQuery(api.auth.getCurrentUser, {}))
  const [draft, setDraft] = useState('')
  const setMessage = useMutation({ mutationFn: useConvexMutation(api.status.set) })

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>wordle-teams v2 walking skeleton</h1>
      <p data-testid="signed-in-email">Signed in as {user?.email}</p>
      <button
        onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => location.reload() } })}
      >
        Sign out
      </button>
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
