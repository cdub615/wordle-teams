'use client'

import SubmitButton from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { retry, signup } from './actions'

export default function SignupForm({ awaitingVerification }: { awaitingVerification: boolean }) {
  return (
    <form action={signup}>
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
        {awaitingVerification ? (
          <Button formAction={retry} variant={'secondary'}>
            Retry
          </Button>
        ) : (
          <SubmitButton label={'Sign Up'} />
        )}
      </CardFooter>
    </form>
  )
}
