import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Login',
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <AlertDialog open={true}>
      <AlertDialogContent>{children}</AlertDialogContent>
    </AlertDialog>
  )
}
