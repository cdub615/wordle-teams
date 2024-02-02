import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Create Team',
}

export default function CreateTeamLayout({ children }: { children: React.ReactNode }) {
  return (
    <AlertDialog open={true}>
      <AlertDialogContent>{children}</AlertDialogContent>
    </AlertDialog>
  )
}
