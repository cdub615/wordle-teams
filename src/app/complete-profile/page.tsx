'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { clearCookie } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import { log } from 'next-axiom'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import updateProfile from './actions'

export default function Page() {
  const [pending, setPending] = useState(false)
  const router = useRouter()
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    setPending(true)
    e.preventDefault()
    const formData: FormData = new FormData(e.currentTarget)
    const { error } = await updateProfile(formData)
    if (error) {
      log.error('Failed to update profile', { error })
      toast.error(error)
      setPending(false)
    }
    router.push('/me')
  }

  useEffect(() => {
    clearCookie('awaitingVerification')
  }, [])
  return (
    <div className='flex justify-center mt-24 px-6'>
      <div className='max-w-lg'>
        <div className='text-3xl md:text-4xl text-center font-semibold leading-loose'>Complete Your Profile</div>
        <div className='text-muted-foreground text-center'>Please provide your name to complete your profile</div>
        <form onSubmit={handleSubmit}>
          <div className='flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-6 my-6'>
            <div className='w-full'>
              <Label htmlFor='firstName'>First Name</Label>
              <Input type='text' name='firstName' required />
            </div>
            <div className='w-full'>
              <Label htmlFor='lastName'>Last Name</Label>
              <Input type='text' name='lastName' required />
            </div>
          </div>
          <div className='flex justify-end'>
            <Button type='submit' variant={'secondary'} aria-disabled={pending} disabled={pending}>
              {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              Submit
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
