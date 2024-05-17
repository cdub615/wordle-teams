import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cookies } from 'next/headers'
import LoginForm from './login-form'
import { GitHubLogin } from './oauth'
import SignupForm from './signup-form'

export default async function Page() {
  const cookieStore = cookies()
  const awaitingVerification = (cookieStore.get('awaitingVerification')?.value ?? '') === 'true'
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
            <LoginForm awaitingVerification={awaitingVerification} />
          </Card>
        </TabsContent>
        <TabsContent value='signup'>
          <Card>
            <SignupForm awaitingVerification={awaitingVerification} />
          </Card>
        </TabsContent>
      </Tabs>
      <div className='flex justify-center items-center space-x-4'>
        <Separator className='w-[30%]' />
        <span>or sign in using</span>
        <Separator className='w-[30%]' />
      </div>
      <GitHubLogin />
    </>
  )
}
