import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
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
        <AlertDialogContent className='w-11/12 rounded-lg'>
          <AlertDialogHeader>
            {/*
            `AlertDialogTitle` is required for accessibility, but we use 
            Tailwind's `sr-only` class to hide it from sighted users.
            */}
            <AlertDialogTitle className="sr-only">
              Login / Signup
            </AlertDialogTitle>
          </AlertDialogHeader>
          {children}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
