'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { retry } from './actions'

export default function LoginToast({ failedOTP }: { failedOTP: boolean }) {
  const [isToastOpen, setIsToastOpen] = useState(false)

  useEffect(() => {
    const reset = async () => await retry()

    if (failedOTP && !isToastOpen) {
      setIsToastOpen(true)
      toast.error('Login failed. Link may have expired. Please try again.', {
        onAutoClose: () => setIsToastOpen(false),
        onDismiss: () => setIsToastOpen(false),
      })
      reset()
    }
  }, [isToastOpen, failedOTP])

  return <></>
}
