'use client'

import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

type SubmitButtonProps = {
  label?: string
  children?: ReactNode
}

export default function SubmitButton({ label, children, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus()

  if (children)
    return (
      <Button
        type='submit'
        size={'icon'}
        variant={'outline'}
        aria-disabled={pending}
        disabled={pending}
        {...props}
      >
        {pending ? <Loader2 className='h-4 w-4 animate-spin' /> : children}
      </Button>
    )

  return (
    <Button type='submit' variant={'secondary'} aria-disabled={pending} disabled={pending} {...props}>
      {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
      {label}
    </Button>
  )
}
