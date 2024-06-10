import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog'
import Welcome from '@/components/welcome'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Install',
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Welcome autoRedirect={false} />
      <AlertDialog open={true}>
        <AlertDialogContent className='w-11/12 rounded-lg'>{children}</AlertDialogContent>
      </AlertDialog>
    </>
  )
}
