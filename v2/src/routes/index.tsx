import { createFileRoute } from '@tanstack/react-router'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useSuspenseQuery, useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.status.get, {}))
  },
  component: Home,
})

function Home() {
  const { data: message } = useSuspenseQuery(convexQuery(api.status.get, {}))
  const [draft, setDraft] = useState('')
  const setMessage = useMutation({ mutationFn: useConvexMutation(api.status.set) })

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>wordle-teams v2 walking skeleton</h1>
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
