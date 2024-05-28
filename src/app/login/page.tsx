'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getCookie } from '@/lib/utils'
import Link from 'next/link'
import { Dispatch, SetStateAction, useEffect, useState } from 'react'
import { retry } from './actions'
import LoginForm from './login-form'
import OAuthLogin from './oauth'
import SignupForm from './signup-form'

export default function Page() {
  const [awaitingVerification, setAwaitingVerification] = useState(false)
  const [emailSignin, setEmailSignin] = useState(false)
  const backToOauth = () => setEmailSignin(false)
  const handleRetry = async () => await retry()

  useEffect(() => {
    setAwaitingVerification(getCookie('awaitingVerification'))
  }, [awaitingVerification])

  return (
    <>
      <div className='flex justify-center mt-2'>
        <div className='text-4xl font-semibold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400'>
          Wordle Teams
        </div>
      </div>
      {awaitingVerification && (
        <div className='flex flex-col text-muted-foreground my-6 space-y-4'>
          <div className='text-center text-xl'>Verification email sent.</div>
          <div className='text-center pb-4'>Please check your inbox to complete your login.</div>
          <Button type='button' onClick={handleRetry} variant={'secondary'}>
            Retry
          </Button>
        </div>
      )}
      {!awaitingVerification && (
        <>
          <div className='flex justify-center mb-2'>
            <div className='text-muted-foreground'>Please sign in to continue</div>
          </div>
          {!emailSignin && (
            <>
              <div className='grid grid-cols-3 gap-4'>
                <OAuthLogin provider='google' />
                <OAuthLogin provider='twitter' />
                <OAuthLogin provider='azure' />
                <OAuthLogin provider='github' />
                <OAuthLogin provider='slack' />
                <OAuthLogin provider='discord' />
              </div>
              <div className='flex items-center justify-center space-x-4'>
                <Separator className='w-[40%]' />
                <p className='text-muted-foreground'>or</p>
                <Separator className='w-[40%]' />
              </div>
              <div className='flex justify-center'>
                <Button onClick={() => setEmailSignin(true)} variant='outline' className='w-full'>
                  Sign in with Email
                </Button>
              </div>
            </>
          )}
          {emailSignin && (
            <EmailSignin backToOauth={backToOauth} setAwaitingVerification={setAwaitingVerification} />
          )}
          <p className='text-xs text-center text-muted-foreground pt-4'>
            By signing in, you agree to our <Link href='/terms' className='underline'>Terms of Service</Link> and{' '}
            <Link href='/privacy' className='underline'>Privacy Policy</Link>
          </p>
        </>
      )}
    </>
  )
}

type EmailSigninProps = {
  backToOauth: () => void
  setAwaitingVerification: Dispatch<SetStateAction<boolean>>
}

function EmailSignin({ backToOauth, setAwaitingVerification }: EmailSigninProps) {
  return (
    <Tabs defaultValue='login'>
      <TabsList className='grid w-full grid-cols-2'>
        <TabsTrigger value='login'>Log In</TabsTrigger>
        <TabsTrigger value='signup'>Sign Up</TabsTrigger>
      </TabsList>
      <TabsContent value='login'>
        <Card>
          <LoginForm backToOauth={backToOauth} setAwaitingVerification={setAwaitingVerification} />
        </Card>
      </TabsContent>
      <TabsContent value='signup'>
        <Card>
          <SignupForm backToOauth={backToOauth} setAwaitingVerification={setAwaitingVerification} />
        </Card>
      </TabsContent>
    </Tabs>
  )
}
