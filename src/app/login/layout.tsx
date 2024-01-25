import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog'
import type { Metadata } from 'next'
import {cookies} from 'next/headers'

export const metadata: Metadata = {
  title: 'Login',
}

export default function LoginLayout({children}: {children: React.ReactNode}) {
  const keys = cookies().getAll().keys
  return (
    <AlertDialog open={true}>
      <AlertDialogContent>{children}</AlertDialogContent>
    </AlertDialog>
  )
}
