import {
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import Link from 'next/link'
import createTeam from './actions'

export default function CreateTeam({ params }: { params: { initials: string } }) {
  const { initials } = params
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Create Team</AlertDialogTitle>
        <AlertDialogDescription>
          Enter your team&apos;s name and specify whether you want to include weekend scores
        </AlertDialogDescription>
      </AlertDialogHeader>
      <form action={createTeam} className='w-full space-y-6'>
        <div className='grid gap-4 py-4'>
          <div className='grid grid-cols-3 items-center gap-4'>
            <Label htmlFor='name' className='text-right'>
              Team Name
            </Label>
            <Input name='name' className='col-span-2' minLength={2} required />
          </div>
          <div className='grid grid-cols-3 items-center gap-4'>
            <Label htmlFor='playWeekends' className='text-right'>
              Play Weekends
            </Label>
            <Switch name='playWeekends' />
          </div>
        </div>
        <input type='hidden' name='initials' value={initials} />
        <AlertDialogFooter>
          <Link href={`/${initials}`}>
            <Button variant={'secondary'}>Cancel</Button>
          </Link>
          <Button type='submit'>Save</Button>
        </AlertDialogFooter>
      </form>
    </>
  )
}
