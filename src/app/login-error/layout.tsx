import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog'
import Welcome from '@/components/welcome'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Login / Signup',
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Welcome />
      <AlertDialog open={true}>
        <AlertDialogContent>{children}</AlertDialogContent>
      </AlertDialog>
    </>
  )
}
