'use client'

import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dispatch, SetStateAction } from 'react'
import LoginForm from './login-form'
import SignupForm from './signup-form'

type EmailSigninProps = {
  backToOauth: () => void
  setAwaitingVerification: Dispatch<SetStateAction<boolean>>
  setEmail: Dispatch<SetStateAction<string>>
}

export default function EmailSignin({ backToOauth, setAwaitingVerification, setEmail }: EmailSigninProps) {
  return (
    <Tabs defaultValue='login'>
      <TabsList className='grid w-full grid-cols-2'>
        <TabsTrigger value='login'>Log In</TabsTrigger>
        <TabsTrigger value='signup'>Sign Up</TabsTrigger>
      </TabsList>
      <TabsContent value='login'>
        <Card>
          <LoginForm backToOauth={backToOauth} setAwaitingVerification={setAwaitingVerification} setEmail={setEmail} />
        </Card>
      </TabsContent>
      <TabsContent value='signup'>
        <Card>
          <SignupForm backToOauth={backToOauth} setAwaitingVerification={setAwaitingVerification} setEmail={setEmail} />
        </Card>
      </TabsContent>
    </Tabs>
  )
}
