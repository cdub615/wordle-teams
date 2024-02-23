import { Button } from '@/components/ui/button'
import { useFormStatus } from 'react-dom'

export default function Submit({ submitDisabled }: { submitDisabled: boolean }) {
  const { pending } = useFormStatus()

  return (
    <Button
      disabled={pending || submitDisabled}
      aria-disabled={pending || submitDisabled}
      type='submit'
      id='board-submit'
      tabIndex={5}
      className='focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-transparent'
    >
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
      Submit
    </Button>
  )
}
