'use client'

import { Button } from '@/components/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { clearCookie, getCookie } from '@/lib/utils'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { retry, verifyOtp } from '../actions'

export const OtpSchema = z.object({
  otp: z.string().min(6, {
    message: 'Your one-time passcode must be 6 characters.',
  }),
  email: z.string().email({ message: 'Please enter a valid email that includes @ and .' }),
})

export default function Otp() {
  const [pending, setPending] = useState(false)
  const router = useRouter()
  const cookieEmail = getCookie('email') ?? ''

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPending(true)
    const formData = new FormData(e.currentTarget)
    const result = await verifyOtp(formData)
    if (result.error) toast.error(result.error)
    else {
      clearCookie('email')
      router.push('/me')
    }
    setPending(false)
  }
  const handleRetry = async () => await retry()

  return (
    <div className='w-full flex flex-col mt-6 space-y-4 items-center'>
      <form onSubmit={handleSubmit} className='w-full space-y-8 text-center'>
        <input hidden readOnly name='email' value={cookieEmail} />
        <Label className='text-lg leading-loose'>One-Time Passcode</Label>
        <InputOTP
          name='otp'
          minLength={6}
          maxLength={6}
          pattern={REGEXP_ONLY_DIGITS}
          containerClassName='justify-center'
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
        <p className='w-48 mx-auto pt-2 text-muted-foreground text-sm'>
          Please enter the one-time passcode sent to your email.
        </p>
        <div className='flex flex-col mt-4 w-full justify-center items-center'>
          <Button
            type='submit'
            variant={'secondary'}
            className='w-full max-w-xs'
            aria-disabled={pending}
            disabled={pending}
          >
            {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Submit
          </Button>
          <div className='flex justify-center items-center mt-6'>
            <p className='text-muted-foreground text-xs mr-2'>Can&apos;t find the email?</p>
            <Button
              type='button'
              onClick={handleRetry}
              variant={'ghost'}
              className='underline text-xs text-muted-foreground hover:bg-transparent'
            >
              Retry
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
