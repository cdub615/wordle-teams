'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { toast } from '@/components/ui/use-toast'
import type { Database } from '@/lib/database.types'

// TODO form validation, maybe use shadcn form component with zod schema and such

export default function Login() {
  const [tabValue, setTabValue] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [verificationEmailSent, setVerificationEmailSent] = useState(false)
  const router = useRouter()
  const supabase = createClientComponentClient<Database>()
  const resetState = () => {
    setEmail('')
    setPassword('')
    setFirstName('')
    setLastName('')
  }
  const handleTabChange = (newTab: string) => {
    resetState()
    setTabValue(newTab)
  }

  const handleSignUp = async () => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
        data: {
          firstName,
          lastName,
        },
      },
    })

    if (error && error.status === 400 && error.message == 'User already registered') {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) {
        console.log(`Error logging in already registered user. Status: ${error.status}; Message: ${error.message}`)
        toast({
          title: 'Sign up failed',
          description: 'An unexpected error occurred during sign in, please try again.',
          variant: 'destructive',
        })
        resetState()
      } else router.refresh()
    } else if (error) {
      console.log(`Signup error. Status: ${error.status}; Message: ${error.message}`)
      toast({
        title: 'Sign up failed',
        description: 'An unexpected error occurred during sign in, please try again.',
        variant: 'destructive',
      })
      resetState()
    }
    if (data.user && !data.session) {
      setVerificationEmailSent(true)
      resetState()
    } else router.refresh()
  }

  const handleLogIn = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) {
      console.log(`Login error. Status: ${error.status}; Message: ${error.message}`)
      toast({
        title: 'Log in failed',
        description: 'Either Email or Password was incorrect. Please try again.',
        variant: 'destructive',
      })
      setPassword('')
    } else router.refresh()
  }

  const resetPassword = async () => {
    const emailAddress = prompt('Please provide your email for password reset') ?? ''
    // TODO if email is empty show some sort of error
    const { error } = await supabase.auth.resetPasswordForEmail(emailAddress, {
      redirectTo: `${location.origin}/update-password`,
    })
    if (error) {
      console.log(`Password reset. Status: ${error.status}; Message: ${error.message}`)
      toast({
        title: 'Password reset failed',
        description: 'An unexpected error occurred while resetting password. Please try again.',
        variant: 'destructive',
      })
      resetState()
    }
  }

  return (
    <>
      <div className='flex justify-center mt-2'>
        <div className='text-4xl font-semibold text-transparent bg-clip-text bg-gradient-to-r from-green-600 via-green-500 to-yellow-400'>
          Wordle Teams
        </div>
      </div>
      <div className='flex justify-center mb-2'>
        <div className='text-muted-foreground'>Please log in or sign up to continue</div>
      </div>
      <Tabs defaultValue={tabValue} onValueChange={(newTab) => handleTabChange(newTab)}>
        <TabsList className='grid w-full grid-cols-2'>
          <TabsTrigger value='login'>Log In</TabsTrigger>
          <TabsTrigger value='signup'>Sign Up</TabsTrigger>
        </TabsList>
        <TabsContent value='login'>
          <Card>
            <CardHeader>
              <CardTitle>Log In</CardTitle>
              <CardDescription>Log in with email and password</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2'>
              <div className='space-y-1'>
                <Label htmlFor='email'>Email</Label>
                <Input id='email' type='email' onChange={(e) => setEmail(e.target.value)} value={email} />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='password'>Password</Label>
                <Input
                  id='password'
                  type='password'
                  onChange={(e) => setPassword(e.target.value)}
                  value={password}
                />
              </div>
              <div className='text-muted-foreground underline text-sm cursor-pointer' onClick={resetPassword}>
                Forgot your password? Reset it here.
              </div>
            </CardContent>
            <CardFooter className='justify-end'>
              <Button onClick={handleLogIn}>Log In</Button>
            </CardFooter>
          </Card>
        </TabsContent>
        <TabsContent value='signup'>
          <Card>
            <CardHeader>
              <CardTitle>Sign Up</CardTitle>
              {!verificationEmailSent && <CardDescription>Sign up with name, email, and password</CardDescription>}
            </CardHeader>
            <CardContent className='space-y-2'>
              {verificationEmailSent ? (
                <div className='text-muted-foreground'>
                  Verification email sent. Please complete verification, then come back and refresh.
                </div>
              ) : (
                <>
                  <div className='flex space-x-2'>
                    <div className='space-y-1'>
                      <Label htmlFor='firstName'>First Name</Label>
                      <Input id='firstName' onChange={(e) => setFirstName(e.target.value)} value={firstName} />
                    </div>
                    <div className='space-y-1'>
                      <Label htmlFor='lastName'>Last Name</Label>
                      <Input id='lastName' onChange={(e) => setLastName(e.target.value)} value={lastName} />
                    </div>
                  </div>
                  <div className='space-y-1'>
                    <Label htmlFor='email'>Email</Label>
                    <Input id='email' type='email' onChange={(e) => setEmail(e.target.value)} value={email} />
                  </div>
                  <div className='space-y-1'>
                    <Label htmlFor='password'>Password</Label>
                    <Input
                      id='password'
                      type='password'
                      onChange={(e) => setPassword(e.target.value)}
                      value={password}
                    />
                  </div>
                </>
              )}
            </CardContent>
            {!verificationEmailSent && (
              <CardFooter className='justify-end'>
                <Button onClick={handleSignUp}>Sign Up</Button>
              </CardFooter>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
