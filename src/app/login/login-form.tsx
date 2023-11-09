'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Session, createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { toast } from '@/components/ui/use-toast'
import type { Database } from '@/lib/database.types'
import { zodResolver } from '@hookform/resolvers/zod'
import { log } from 'next-axiom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { LoginSchema, SignupSchema, validEmail } from './login-utils'

export default function LoginForm({ session }: { session: Session | null }) {
  const router = useRouter()
  if (session) router.replace('/')
  const supabase = createClientComponentClient<Database>()
  const [tabValue, setTabValue] = useState('login')
  const [verificationEmailSent, setVerificationEmailSent] = useState(false)

  const loginForm = useForm<z.infer<typeof LoginSchema>>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })
  const signupForm = useForm<z.infer<typeof SignupSchema>>({
    resolver: zodResolver(SignupSchema),
    defaultValues: {
      email: '',
      password: '',
      firstName: '',
      lastName: '',
    },
  })

  const handleTabChange = (newTab: string) => {
    signupForm.reset()
    loginForm.reset()
    setTabValue(newTab)
  }

  const handleSignUp = async (signupData: z.infer<typeof SignupSchema>) => {
    const { email, password, firstName, lastName } = signupData
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
        log.error(`Error logging in already registered user.`, { error })
        toast({
          title: 'Sign up failed',
          description: 'An unexpected error occurred during sign in, please try again.',
        })
        signupForm.reset()
      } else router.refresh()
    } else if (error) {
      log.error(`Signup error.`, { error })
      toast({
        title: 'Sign up failed',
        description: 'An unexpected error occurred during sign in, please try again.',
      })
      signupForm.reset()
    }

    if (data.user && !data.session) {
      setVerificationEmailSent(true)
      signupForm.reset()
    }
  }

  const handleLogIn = async (loginData: z.infer<typeof LoginSchema>) => {
    const { email, password } = loginData
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    log.info('login data', { data })
    if (error && error.message.includes('Email not confirmed')) {
      log.error(`Login error.`, { error })
      toast({
        title: 'Log in failed',
        description: 'Email not confirmed. Please confirm your email before logging in.',
      })
      loginForm.reset()
    } else if (error) {
      log.error(`Login error.`, { error })
      toast({
        title: 'Log in failed',
        description: 'Either Email or Password was incorrect. Please try again.',
      })
      loginForm.reset()
    } else router.refresh()
  }

  const resetPassword = async () => {
    let emailAddress = prompt('Please provide your email for password reset') ?? ''
    if (!validEmail(emailAddress)) emailAddress = prompt('Invalid or no email provided, please try again') ?? ''
    if (!validEmail(emailAddress)) {
      toast({
        title: 'Password reset failed',
        description: 'Invalid or no email provided. Please provide a valid email for resetting your password.',
      })
      loginForm.reset()
    }

    const { error } = await supabase.auth.resetPasswordForEmail(emailAddress, {
      redirectTo: `${location.origin}/update-password`,
    })
    if (error) {
      log.error(`Password reset failed.`, { error })
      toast({
        title: 'Password reset failed',
        description: 'An unexpected error occurred while resetting password. Please try again.',
      })
      loginForm.reset()
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
            <Form {...loginForm}>
              <form onSubmit={loginForm.handleSubmit(handleLogIn)}>
                <CardHeader>
                  <CardTitle>Log In</CardTitle>
                  <CardDescription>Log in with email and password</CardDescription>
                </CardHeader>
                <CardContent className='space-y-2'>
                  <FormField
                    control={loginForm.control}
                    name='email'
                    render={({ field }) => (
                      <FormItem>
                        <div className='flex flex-col space-y-2'>
                          <FormLabel>Email</FormLabel>
                          <FormControl className='col-span-3'>
                            <Input {...field} />
                          </FormControl>
                        </div>
                        <FormMessage className='w-full text-center py-2' />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={loginForm.control}
                    name='password'
                    render={({ field }) => (
                      <FormItem>
                        <div className='flex flex-col space-y-2'>
                          <FormLabel>Password</FormLabel>
                          <FormControl className='col-span-3'>
                            <Input type='password' {...field} />
                          </FormControl>
                        </div>
                        <FormMessage className='w-full text-center py-2' />
                      </FormItem>
                    )}
                  />
                  <div
                    className='pt-2 text-muted-foreground underline text-sm cursor-pointer'
                    onClick={resetPassword}
                  >
                    Forgot your password? Reset it here.
                  </div>
                </CardContent>
                <CardFooter className='justify-end'>
                  <Button type='submit' variant={'secondary'}>
                    Log In
                  </Button>
                </CardFooter>
              </form>
            </Form>
          </Card>
        </TabsContent>
        <TabsContent value='signup'>
          <Card>
            <Form {...signupForm}>
              <form onSubmit={signupForm.handleSubmit(handleSignUp)}>
                <CardHeader>
                  <CardTitle>Sign Up</CardTitle>
                  {!verificationEmailSent && (
                    <CardDescription>Sign up with name, email, and password</CardDescription>
                  )}
                </CardHeader>
                <CardContent className='space-y-2'>
                  {verificationEmailSent ? (
                    <div className='text-muted-foreground'>
                      Verification email sent. Please complete verification, then come back and refresh.
                    </div>
                  ) : (
                    <>
                      <div className='flex space-x-4'>
                        <FormField
                          control={signupForm.control}
                          name='firstName'
                          render={({ field }) => (
                            <FormItem>
                              <div className='flex flex-col space-y-2'>
                                <FormLabel>First Name</FormLabel>
                                <FormControl className='col-span-3'>
                                  <Input {...field} />
                                </FormControl>
                              </div>
                              <FormMessage className='w-full text-center py-2' />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={signupForm.control}
                          name='lastName'
                          render={({ field }) => (
                            <FormItem>
                              <div className='flex flex-col space-y-2'>
                                <FormLabel>Last Name</FormLabel>
                                <FormControl className='col-span-3'>
                                  <Input {...field} />
                                </FormControl>
                              </div>
                              <FormMessage className='w-full text-center py-2' />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={signupForm.control}
                        name='email'
                        render={({ field }) => (
                          <FormItem>
                            <div className='flex flex-col space-y-2'>
                              <FormLabel>Email</FormLabel>
                              <FormControl className='col-span-3'>
                                <Input {...field} />
                              </FormControl>
                            </div>
                            <FormMessage className='w-full text-center py-2' />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={signupForm.control}
                        name='password'
                        render={({ field }) => (
                          <FormItem>
                            <div className='flex flex-col space-y-2'>
                              <FormLabel>Password</FormLabel>
                              <FormControl className='col-span-3'>
                                <Input type='password' {...field} />
                              </FormControl>
                            </div>
                            <FormMessage className='w-full text-center py-2' />
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                </CardContent>
                {!verificationEmailSent && (
                  <CardFooter className='justify-end'>
                    <Button type='submit' variant={'secondary'}>
                      Sign Up
                    </Button>
                  </CardFooter>
                )}
              </form>
            </Form>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
