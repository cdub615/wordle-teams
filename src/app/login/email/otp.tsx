'use client'

import { Button } from '@/components/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { clearCookie, getCookie } from '@/lib/utils'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { retry, verifyOtp } from '../actions'
import { otpSchema } from './schemas'

export default function Otp() {
  const [pending, setPending] = useState(false)
  const [otp, setOtp] = useState('')
  // getCookie reads document.cookie and returns null on the server. Today that is
  // harmless because the parent only mounts this component after its own effect
  // reads the awaitingVerification cookie (login/page.tsx:14), so it never renders
  // on the server — but that is the parent's business, not ours. Reading after
  // mount means this form is correct whether or not it is ever server-rendered.
  const [email, setEmail] = useState('')
  const router = useRouter()

  useEffect(() => setEmail(getCookie('email') ?? ''), [])

  const valid = otpSchema.safeParse({ otp, email }).success

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // The submit button is disabled unless `valid`, so this covers what a disabled
    // button cannot: a submit dispatched by something other than that button.
    const parsed = otpSchema.safeParse({ otp, email })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message)
      return
    }
    setPending(true)
    // Built from state rather than the form element. The code lives in a controlled
    // input and the address comes from a cookie read after mount, so state is the
    // only place both are reliably populated.
    const formData = new FormData()
    formData.set('email', parsed.data.email)
    formData.set('otp', parsed.data.otp)
    const result = await verifyOtp(formData)
    if (result.error) {
      toast.error(result.error)
      setPending(false)
    }
    else {
      clearCookie('email')
      router.push('/me')
    }
  }
  const handleRetry = async () => await retry()

  return (
    <div className='w-full flex flex-col mt-6 space-y-4 items-center'>
      <form onSubmit={handleSubmit} className='w-full space-y-8 text-center'>
        <Label className='text-lg leading-loose'>One-Time Passcode</Label>
        <InputOTP
          name='otp'
          value={otp}
          onChange={setOtp}
          minLength={6}
          maxLength={6}
          pattern={REGEXP_ONLY_DIGITS}
          containerClassName='justify-center'
          disabled={pending}
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
          {/* Disabled until the code is complete and the address has been read back
              from the cookie. It has to be the button's disabled state rather than a
              check inside onClick, because a disabled default button also suppresses
              implicit submission — pressing Enter in the code field. Both states
              start empty, so the button is disabled on the very first render. */}
          <Button
            type='submit'
            variant={'secondary'}
            className='w-full max-w-xs'
            aria-disabled={pending || !valid}
            disabled={pending || !valid}
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
