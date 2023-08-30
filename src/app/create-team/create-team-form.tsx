'use client'

import { AlertDialogFooter } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import createTeam from './actions'

const CreateTeamForm = () => {
  const router = useRouter()
  const [playWeekends, setPlayWeekends] = useState(false)

  return (
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
          <Switch name='playWeekends' checked={playWeekends} onCheckedChange={setPlayWeekends} />
        </div>
      </div>
      <AlertDialogFooter>
        <Button onClick={() => router.back()} variant={'secondary'}>
          Cancel
        </Button>
        <Button type='submit'>Save</Button>
      </AlertDialogFooter>
    </form>
  )
}

export default CreateTeamForm
