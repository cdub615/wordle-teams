import SubmitButton from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import updateProfile from './actions'

export default async function Page() {
  // On the create profile page, add these cards to that page as well, and ensure name is filled out before
  // allowing click on links, and on click save the player's name and then redirect to checkout
  return (
    <div className='flex justify-center mt-24 px-6'>
      <div className='max-w-lg'>
        <div className='text-3xl md:text-4xl text-center font-semibold leading-loose'>Complete Your Profile</div>
        <div className='text-muted-foreground text-center'>Please provide your name to complete your profile</div>
        <form action={updateProfile}>
          <div className='flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-6 my-6'>
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
            <SubmitButton label='Submit' />
          </div>
        </form>
      </div>
    </div>
  )
}
