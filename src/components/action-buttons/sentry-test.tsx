'use client'

import { Button } from '@/components/ui/button'

export default function SentryClientTest() {
  const testSentryClient = () => {
    throw new Error('testing Sentry from client component')
  }
  return <Button onClick={testSentryClient}>Sentry Client Test</Button>
}
