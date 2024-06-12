'use client'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import OAuthProvider from './oauth-provider'

export default function OAuthSignin({ switchToEmail }: { switchToEmail: () => void }) {
  return (
    <>
      <div className='grid grid-cols-3 gap-4'>
        <OAuthProvider provider='google' />
        <OAuthProvider provider='twitter' />
        <OAuthProvider provider='azure' />
        <OAuthProvider provider='github' />
        <OAuthProvider provider='slack' />
        <OAuthProvider provider='discord' />
      </div>
      <div className='flex items-center justify-center space-x-4'>
        <Separator className='w-[40%]' />
        <p className='text-muted-foreground'>or</p>
        <Separator className='w-[40%]' />
      </div>
      <div className='flex justify-center'>
        <Button onClick={switchToEmail} variant='outline' className='w-full'>
          Sign in with Email
        </Button>
      </div>
    </>
  )
}
