'use client'

import About from '@/components/about'
import CreateTeam from '@/components/action-buttons/teams-dropdown/create-team'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'

export default function Intro() {
  return (
    <div className='flex flex-col py-12 md:py-20 space-y-8 md:space-y-16'>
      <h1 className='text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-center leading-tight md:leading-tight lg:leading-snug'>
        Welcome to
        <br />
        <span>Wordle Teams</span>
      </h1>
      <About />
      <div className='flex justify-center my-4'>
        <Dialog>
          <DialogTrigger asChild>
            <Button>Create a Team</Button>
          </DialogTrigger>
          <CreateTeam />
        </Dialog>
      </div>
    </div>
  )
}
