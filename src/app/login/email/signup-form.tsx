'use client'

import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setCookie } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import { Dispatch, FormEvent, SetStateAction, useState } from 'react'
import { toast } from 'sonner'
import { signup } from '../actions'

type SignupFormProps = {
  backToOauth: () => void
  setAwaitingVerification: Dispatch<SetStateAction<boolean>>
  // Set when a login attempt found no account for this address and handed the user
  // here. Empty when they opened the tab themselves.
  initialEmail?: string
}

export default function SignupForm({ backToOauth, setAwaitingVerification, initialEmail }: SignupFormProps) {
  const handedOff = !!initialEmail
  const [pending, setPending] = useState(false)
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPending(true)
    const formData: FormData = new FormData(e.currentTarget)
    setCookie('email', formData.get('email') as string)
    const result = await signup(formData)
    if (result.error) {
      toast.error(result.error)
      setPending(false)
    } else setAwaitingVerification(true)
  }

  return (
    <form onSubmit={handleSubmit}>
      <CardHeader>
        <CardTitle>Sign Up</CardTitle>
        <CardDescription>
          {handedOff
            ? "Looks like you're new here — add your name and we'll send your code."
            : 'Sign up with name and email'}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-2'>
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
            {/* Keyed on the carried address so the field re-mounts and picks up a new
                defaultValue if this component is still mounted when the hand-off
                happens. Keeps the input uncontrolled, like the two beside it. */}
            <Input
              key={initialEmail}
              className='col-span-3'
              type='email'
              name='email'
              defaultValue={initialEmail}
              required
            />
          </div>
        </>
      </CardContent>
      <CardFooter className='justify-end'>
        <Button type='button' variant='outline' onClick={backToOauth} className='mr-4'>
          Back
        </Button>
        <Button type='submit' variant={'secondary'} aria-disabled={pending} disabled={pending}>
          {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          Sign Up
        </Button>
      </CardFooter>
    </form>
  )
}
