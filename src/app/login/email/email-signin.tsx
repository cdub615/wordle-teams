'use client'

import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dispatch, SetStateAction, useState } from 'react'
import LoginForm from './login-form'
import SignupForm from './signup-form'

type EmailSigninProps = {
  backToOauth: () => void
  setAwaitingVerification: Dispatch<SetStateAction<boolean>>
}

export default function EmailSignin({ backToOauth, setAwaitingVerification }: EmailSigninProps) {
  // Controlled so a login attempt with an unknown address can move the user to Sign
  // Up itself, carrying the address across. Manual tab clicks clear the carried
  // address: switching by hand means the user is starting over, and leaving a
  // prefilled field behind would look like the form remembered something it should
  // not have.
  const [tab, setTab] = useState('login')
  const [signupEmail, setSignupEmail] = useState('')

  const handleTabChange = (value: string) => {
    setSignupEmail('')
    setTab(value)
  }

  const handleNeedsSignup = (email: string) => {
    setSignupEmail(email)
    setTab('signup')
  }

  return (
    <Tabs value={tab} onValueChange={handleTabChange}>
      <TabsList className='grid w-full grid-cols-2'>
        <TabsTrigger value='login'>Log In</TabsTrigger>
        <TabsTrigger value='signup'>Sign Up</TabsTrigger>
      </TabsList>
      <TabsContent value='login'>
        <Card>
          <LoginForm
            backToOauth={backToOauth}
            setAwaitingVerification={setAwaitingVerification}
            onNeedsSignup={handleNeedsSignup}
          />
        </Card>
      </TabsContent>
      <TabsContent value='signup'>
        <Card>
          <SignupForm
            backToOauth={backToOauth}
            setAwaitingVerification={setAwaitingVerification}
            initialEmail={signupEmail}
          />
        </Card>
      </TabsContent>
    </Tabs>
  )
}
