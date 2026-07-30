'use client'

import ErrorMessage from '@/components/error-message'

// Root-segment error boundary. Without this, any page error escalated straight
// to global-error.tsx, which replaces the entire document. This keeps ordinary
// page failures recoverable and reserves the global boundary for genuine
// root-layout failures.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorMessage error={error} reset={reset} />
}
