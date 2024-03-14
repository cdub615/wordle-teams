'use client'

import SubmitButton from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { login, retry } from './actions'

export default function LoginForm({ awaitingVerification }: { awaitingVerification: boolean }) {
  return (
    <form action={login}>
      <CardHeader>
        <CardTitle>Log In</CardTitle>
        {!awaitingVerification && <CardDescription>Log in with email</CardDescription>}
      </CardHeader>
      <CardContent className='space-y-2'>
        {awaitingVerification ? (
          <div className='text-muted-foreground'>
            Verification email sent. Please check your inbox to complete your login.
          </div>
        ) : (
          <div className='flex flex-col space-y-2'>
            <Label htmlFor='email'>Email</Label>
            <Input type='email' name='email' required />
          </div>
        )}
      </CardContent>
      <CardFooter className='justify-end'>
        {awaitingVerification ? (
          <Button formAction={retry} variant={'secondary'}>
            Retry
          </Button>
        ) : (
          <SubmitButton label={'Log In'} />
        )}
      </CardFooter>
    </form>
  )
}
