'use client'

import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { login, retry } from './actions'

export default function LoginForm({ awaitingVerification }: { awaitingVerification: boolean }) {
  const [pending, setPending] = useState(false)
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    setPending(true)
    e.preventDefault()
    const formData: FormData = new FormData(e.currentTarget)
    const result = await login(formData)
    if (result.error) toast.error(result.error)
    setPending(false)
  }
  return (
    <form onSubmit={handleSubmit}>
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
          <Button type='submit' variant={'secondary'} aria-disabled={pending} disabled={pending}>
            {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Log In
          </Button>
        )}
      </CardFooter>
    </form>
  )
}
