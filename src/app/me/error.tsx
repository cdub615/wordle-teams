'use client'

import ErrorMessage from '@/components/error-message'
import * as Sentry from '@sentry/nextjs'

export default function Error({ error, reset }: any) {
  Sentry.captureException(error)
  return <ErrorMessage error={error} reset={reset} />
}
