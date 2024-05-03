'use client'

import {Button} from '@/components/ui/button'
import * as Sentry from '@sentry/nextjs'

export default function SentryClientTest() {
  const testSentryClient = () => {
    Sentry.captureException(new Error('testing Sentry from client component'))
  }
  return <Button onClick={testSentryClient}>Sentry Client Test</Button>
}
