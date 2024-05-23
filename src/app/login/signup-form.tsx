'use client'

import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { signup } from './actions'

export default function SignupForm({ backToOauth }: { backToOauth: () => void }) {
  const [pending, setPending] = useState(false)
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPending(true)
    const formData: FormData = new FormData(e.currentTarget)
    const result = await signup(formData)
    if (result.error) toast.error(result.error)
    setPending(false)
  }

  return (
    <form onSubmit={handleSubmit}>
      <CardHeader>
        <CardTitle>Sign Up</CardTitle>
        <CardDescription>Sign up with name and email</CardDescription>
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
            <Input className='col-span-3' type='email' name='email' required />
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
