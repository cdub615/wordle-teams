'use client'

import { Button } from '@/components/ui/button'
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
        {pending ? (
          <svg className='animate-spin h-5 w-5' viewBox='0 0 24 24'>
            <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' />
            <path
              className='opacity-75'
              fill='currentColor'
              d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
            />
          </svg>
        ) : (
          children
        )}
      </Button>
    )

  return (
    <Button type='submit' variant={'secondary'} aria-disabled={pending} disabled={pending} {...props}>
      {pending && (
        <svg className='animate-spin h-5 w-5 mr-3' viewBox='0 0 24 24'>
          <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' />
          <path
            className='opacity-75'
            fill='currentColor'
            d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
          />
        </svg>
      )}
      {label}
    </Button>
  )
}
