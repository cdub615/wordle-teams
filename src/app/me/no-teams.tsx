'use client'

import CreateTeam from '@/components/action-buttons/teams-dropdown/create-team'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'

export default function NoTeams() {
  return (
    <div className='flex justify-center mt-10'>
      <div>
        <p className='text-lg max-w-xs text-center mx-auto'>
          Receive a Team Invite or Create a Team to get started
        </p>
        <div className='flex justify-center my-4'>
          <Dialog>
            <DialogTrigger asChild>
              <Button>Create Team</Button>
            </DialogTrigger>
            <CreateTeam />
          </Dialog>
        </div>
      </div>
    </div>
  )
}
