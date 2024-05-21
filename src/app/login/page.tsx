'use client'

import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import LoginForm from './login-form'
import OAuthLogin from './oauth'
import SignupForm from './signup-form'

export default function Page() {
  const [emailSignin, setEmailSignin] = useState(false)
  const backToOauth = () => setEmailSignin(false)
  return (
    <>
      <div className='flex justify-center mt-2'>
        <div className='text-4xl font-semibold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400'>
          Wordle Teams
        </div>
      </div>
      <div className='flex justify-center mb-2'>
        <div className='text-muted-foreground'>Please sign in to continue</div>
      </div>
      {!emailSignin && (
        <>
          <div className='grid grid-cols-3 gap-4'>
            <OAuthLogin provider='google' />
            <OAuthLogin provider='facebook' />
            <OAuthLogin provider='azure' />
            <OAuthLogin provider='twitter' />
            <OAuthLogin provider='apple' />
            <OAuthLogin provider='github' />
            <OAuthLogin provider='slack' />
            <OAuthLogin provider='discord' />
            <OAuthLogin provider='workos' />
          </div>
          <div className='flex items-center justify-center space-x-4'>
            <Separator className='w-[40%]' />
            <p className='text-muted-foreground'>or</p>
            <Separator className='w-[40%]' />
          </div>
          <div className='flex justify-center'>
            <Button onClick={() => setEmailSignin(true)} variant='outline' className='w-full'>Sign in with Email</Button>
          </div>
        </>
      )}
      {emailSignin && <EmailSignin backToOauth={backToOauth} />}
    </>
  )
}

function EmailSignin({ backToOauth }: { backToOauth: () => void }) {
  return (
    <Tabs defaultValue='login'>
      <TabsList className='grid w-full grid-cols-2'>
        <TabsTrigger value='login'>Log In</TabsTrigger>
        <TabsTrigger value='signup'>Sign Up</TabsTrigger>
      </TabsList>
      <TabsContent value='login'>
        <Card>
          <LoginForm backToOauth={backToOauth} />
        </Card>
      </TabsContent>
      <TabsContent value='signup'>
        <Card>
          <SignupForm backToOauth={backToOauth} />
        </Card>
      </TabsContent>
    </Tabs>
  )
}
