import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { createServerActionClient } from '@supabase/auth-helpers-nextjs'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

import type { Database } from '@/lib/database.types'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

const UpdatePassword = async () => {
  const updatePassword = async (formData: FormData) => {
    'use server'

    const newPassword = formData.get('newPassword')?.toString()
    const supabase = createServerActionClient<Database>({ cookies })
    const { error } = await supabase.auth.updateUser({ password: newPassword })

    if (error) {
      console.log(`Login error. Status: ${error.status}; Message: ${error.message}`)
    }
    revalidatePath('/')
    redirect('/')
  }
  return (
    // TODO figure out how to do form validation
    <AlertDialog open={true}>
      <AlertDialogContent>
        <AlertDialogHeader>Update your password</AlertDialogHeader>
        <AlertDialogDescription>Set a new password to restore access</AlertDialogDescription>
        <form action={updatePassword}>
          <Input name='newPassword' type='password' />
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default UpdatePassword
