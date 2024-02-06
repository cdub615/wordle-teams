'use client'

import { Button } from '@/components/ui/button'
import { useCallback, useState } from 'react'

export default function SubmitButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false)

  const handleClick = useCallback(() => {
    setPending(true)
  }, [setPending])

  return (
    <Button type='submit' variant={'secondary'} aria-disabled={pending} onClick={handleClick}>
      {label}
    </Button>
  )
}
