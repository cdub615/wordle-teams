import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cookies } from 'next/headers'
import { login, signup } from './actions'

export default async function Page() {
  const cookieStore = cookies()
  const verificationEmailSent = (cookieStore.get('verificationEmailSent')?.value ?? '') === 'true'
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
      <Tabs defaultValue='login'>
        <TabsList className='grid w-full grid-cols-2'>
          <TabsTrigger value='login'>Log In</TabsTrigger>
          <TabsTrigger value='signup'>Sign Up</TabsTrigger>
        </TabsList>
        <TabsContent value='login'>
          <Card>
            <form action={login}>
              <CardHeader>
                <CardTitle>Log In</CardTitle>
                <CardDescription>Log in with email</CardDescription>
              </CardHeader>
              <CardContent className='space-y-2'>
                <div className='flex flex-col space-y-2'>
                  <Label htmlFor='email'>Email</Label>
                  <Input type='email' name='email' required />
                </div>
              </CardContent>
              <CardFooter className='justify-end'>
                <Button type='submit' variant={'secondary'}>
                  Log In
                </Button>
              </CardFooter>
            </form>
          </Card>
        </TabsContent>
        <TabsContent value='signup'>
          <Card>
            <form action={signup}>
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
                      <div className='flex flex-col space-y-2'>
                        <Label htmlFor='firstName'>First Name</Label>
                        <Input className='col-span-3' name='firstName' required minLength={1} />
                      </div>
                      <div className='flex flex-col space-y-2'>
                        <Label htmlFor='lastName'>Last Name</Label>
                        <Input className='col-span-3' name='firstName' required minLength={1} />
                      </div>
                    </div>
                    <div className='flex flex-col space-y-2'>
                      <Label htmlFor='email'>Email</Label>
                      <Input className='col-span-3' type='email' name='email' required />
                    </div>
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
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
