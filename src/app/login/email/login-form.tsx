'use client'

import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setCookie } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import { Dispatch, FormEvent, SetStateAction, useState } from 'react'
import { toast } from 'sonner'
import { login } from '../actions'

type LoginFormProps = {
  backToOauth: () => void
  setAwaitingVerification: Dispatch<SetStateAction<boolean>>
  onNeedsSignup: (email: string) => void
}

export default function LoginForm({ backToOauth, setAwaitingVerification, onNeedsSignup }: LoginFormProps) {
  const [pending, setPending] = useState(false)
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPending(true)
    const formData: FormData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    setCookie('email', email)
    const result = await login(formData)
    // No account for this address. Hand off to Sign Up with the address carried
    // over rather than showing a failure — trying to log in is the natural first
    // move for someone who has never been here, and the Log In tab is the default.
    if (result.needsSignup) {
      setPending(false)
      onNeedsSignup(email)
      return
    }
    if (result.error) {
      toast.error(result.error)
      setPending(false)
    } else setAwaitingVerification(true)
  }

  return (
    <form onSubmit={handleSubmit}>
      <CardHeader>
        <CardTitle>Log In</CardTitle>
        <CardDescription>Log in with email</CardDescription>
      </CardHeader>
      <CardContent className='space-y-2'>
        <div className='flex flex-col space-y-2'>
          <Label htmlFor='email'>Email</Label>
          <Input type='email' name='email' required />
        </div>
      </CardContent>
      <CardFooter className='justify-end'>
        <Button type='button' variant='outline' onClick={backToOauth} className='mr-4'>
          Back
        </Button>
        <Button type='submit' variant={'secondary'} aria-disabled={pending} disabled={pending}>
          {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          Log In
        </Button>
      </CardFooter>
    </form>
  )
}
