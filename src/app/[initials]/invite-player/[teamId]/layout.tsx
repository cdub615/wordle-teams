import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Invite Player',
}

export default function InvitePlayerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AlertDialog open={true}>
      {children}
    </AlertDialog>
  )
}
