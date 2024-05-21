'use client'

import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getAwaitingVerification } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { retry, signup } from './actions'

export default function SignupForm({ backToOauth }: { backToOauth: () => void }) {
  const [pending, setPending] = useState(false)
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    setPending(true)
    e.preventDefault()
    const formData: FormData = new FormData(e.currentTarget)
    const result = await signup(formData)
    if (result.error) toast.error(result.error)
    setPending(false)
  }
  const handleRetry = async () => await retry()

  let awaitingVerification = false
  useEffect(() => {
    awaitingVerification = getAwaitingVerification()
  }, [])

  return (
    <form onSubmit={handleSubmit}>
      <CardHeader>
        <CardTitle>Sign Up</CardTitle>
        {!awaitingVerification && <CardDescription>Sign up with name and email</CardDescription>}
      </CardHeader>
      <CardContent className='space-y-2'>
        {awaitingVerification ? (
          <div className='text-muted-foreground'>
            Verification email sent. Please check your inbox to complete your signup.
          </div>
        ) : (
          <>
            <div className='flex space-x-4'>
              <div className='flex flex-col space-y-2'>
                <Label htmlFor='firstName'>First Name</Label>
                <Input className='col-span-3' name='firstName' required minLength={1} />
              </div>
              <div className='flex flex-col space-y-2'>
                <Label htmlFor='lastName'>Last Name</Label>
                <Input className='col-span-3' name='lastName' required minLength={1} />
              </div>
            </div>
            <div className='flex flex-col space-y-2'>
              <Label htmlFor='email'>Email</Label>
              <Input className='col-span-3' type='email' name='email' required />
            </div>
          </>
        )}
      </CardContent>
      <CardFooter className='justify-end'>
      <Button type='button' variant='outline' onClick={backToOauth} className='mr-4'>Back</Button>
        {awaitingVerification ? (
          <Button type='button' onClick={handleRetry} variant={'secondary'}>
            Retry
          </Button>
        ) : (
          <Button type='submit' variant={'secondary'} aria-disabled={pending} disabled={pending}>
            {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Sign Up
          </Button>
        )}
      </CardFooter>
    </form>
  )
}
