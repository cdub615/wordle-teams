'use client'

import ErrorMessage from '@/components/error-message'

export default function Error({ error, reset }: any) {
  return <ErrorMessage error={error} reset={reset} />
}
