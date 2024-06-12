'use client'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { zodResolver } from '@hookform/resolvers/zod'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { retry, verifyOtp } from '../actions'

export const OtpSchema = z.object({
  otp: z.string().min(6, {
    message: 'Your one-time passcode must be 6 characters.',
  }),
  email: z.string().email({ message: 'Please enter a valid email that includes @ and .' }),
})

export default function Otp({ email }: { email: string }) {
  const [pending, setPending] = useState(false)
  const router = useRouter()
  const form = useForm<z.infer<typeof OtpSchema>>({
    resolver: zodResolver(OtpSchema),
    defaultValues: {
      otp: '',
      email: email,
    },
  })

  const handleSubmit = async (data: z.infer<typeof OtpSchema>) => {
    setPending(true)
    const result = await verifyOtp(data)
    if (result.error) toast.error(result.error)
    else router.push('/me')
    setPending(false)
  }
  const handleRetry = async () => await retry()

  return (
    <div className='w-full flex flex-col text-muted-foreground mt-6 space-y-4 items-center'>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className='w-full space-y-8 text-center'>
          <FormField
            control={form.control}
            name='otp'
            render={({ field }) => (
              <FormItem>
                <FormLabel className='text-lg leading-loose'>One-Time Passcode</FormLabel>
                <FormControl>
                  <InputOTP
                    maxLength={6}
                    {...field}
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
                </FormControl>
                <FormDescription className='w-48 mx-auto pt-2'>
                  Please enter the one-time passcode sent to your email.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
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
                className='underline text-xs hover:bg-transparent'
              >
                Retry
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  )
}
