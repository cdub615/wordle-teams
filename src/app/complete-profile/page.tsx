import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '../../components/ui/label'
import updateProfile from './actions'

export default async function Page() {
  return (
    <div className='flex justify-center mt-24'>
      <div className='max-w-lg'>
        <div className='text-4xl text-center font-semibold leading-loose'>Complete Your Profile</div>
        <div className='text-muted-foreground text-center'>Please provide your name to complete your profile</div>
        <form action={updateProfile}>
          <div className='flex space-x-6 my-6'>
            <div className='w-full'>
              <Label htmlFor='firstName'>First Name</Label>
              <Input type='text' name='firstName' required />
            </div>
            <div className='w-full'>
              <Label htmlFor='lastName'>Last Name</Label>
              <Input type='text' name='lastName' required />
            </div>
          </div>
          <div className='flex justify-end'>
            <Button type='submit'>Submit</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
