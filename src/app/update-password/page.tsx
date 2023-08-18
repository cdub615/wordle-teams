import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog'
import { createServerActionClient } from '@supabase/auth-helpers-nextjs'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

import type { Database } from '@/lib/database.types'
import { passwordRegex } from '@/lib/utils'
import { log } from 'next-axiom'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

const UpdatePassword = async () => {
  const updatePassword = async (formData: FormData) => {
    'use server'

    const newPassword = formData.get('newPassword')?.toString()
    const supabase = createServerActionClient<Database>({ cookies })
    const { error } = await supabase.auth.updateUser({ password: newPassword })

    if (error) {
      log.error('Login error.', { error })
    }
    revalidatePath('/')
    redirect('/')
  }
  return (
    <AlertDialog open={true}>
      <AlertDialogContent>
        <AlertDialogHeader>Update your password</AlertDialogHeader>
        <AlertDialogDescription>Set a new password to restore access</AlertDialogDescription>
        <form action={updatePassword}>
          <div className='flex flex-col space-y-2 py-2'>
            <label
              htmlFor='newPassword'
              className='text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
            >
              New Password
            </label>
            <input
              id='newPassword'
              name='newPassword'
              type='password'
              required
              pattern={passwordRegex}
              title='Must contain between 6 and 20 characters, at least one uppercase letter, one lowercase letter, one number, and one special character'
              minLength={6}
              className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 col-span-2'
            />
          </div>
          <div className='flex justify-end pt-4'>
            <button
              type='submit'
              className='inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2'
            >
              Submit
            </button>
          </div>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default UpdatePassword
