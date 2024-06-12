'use client'

import { getCookie } from '@/lib/utils'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { EmailSignin, Otp } from './email'
import OAuthSignin from './oauth'

export default function Page() {
  const [awaitingVerification, setAwaitingVerification] = useState(false)
  const [emailSignin, setEmailSignin] = useState(false)
  const [email, setEmail] = useState('')

  useEffect(() => {
    setAwaitingVerification(getCookie('awaitingVerification'))
  }, [awaitingVerification])

  return (
    <>
      <div className='flex justify-center mt-2'>
        <Link href='/'>
          <div className='text-4xl font-semibold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400'>
            Wordle Teams
          </div>
        </Link>
      </div>
      {awaitingVerification && <Otp email={email} />}
      {!awaitingVerification && (
        <>
          <div className='flex justify-center mb-2'>
            <div className='text-muted-foreground'>Please sign in to continue</div>
          </div>
          {!emailSignin && <OAuthSignin switchToEmail={() => setEmailSignin(true)} />}
          {emailSignin && (
            <EmailSignin
              backToOauth={() => setEmailSignin(false)}
              setAwaitingVerification={setAwaitingVerification}
              setEmail={setEmail}
            />
          )}
          <p className='text-xs text-center text-muted-foreground pt-4'>
            By signing in, you agree to our{' '}
            <Link href='/terms' className='underline'>
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href='/privacy' className='underline'>
              Privacy Policy
            </Link>
          </p>
        </>
      )}
    </>
  )
}
