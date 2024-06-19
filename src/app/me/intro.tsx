'use client'

import About from '@/components/about'
import CreateTeam from '@/components/action-buttons/teams-dropdown/create-team'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import AnimatedGradientText from '@/components/ui/magicui/animated-gradient-text'

const title = (
  <h1 className='text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-center leading-tight md:leading-tight lg:leading-snug'>
    Welcome to
    <br />
    <AnimatedGradientText>
      <span className='text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight animate-gradient bg-gradient-to-r from-yellow-300 via-green-600 to-yellow-300 bg-[length:var(--bg-size)_100%] bg-clip-text text-transparent'>
        Wordle Teams
      </span>
    </AnimatedGradientText>
  </h1>
)

const actionButton = (
  <div className='flex justify-center my-4'>
    <Dialog>
      <DialogTrigger asChild>
        <Button>Create a Team</Button>
      </DialogTrigger>
      <CreateTeam />
    </Dialog>
  </div>
)

export default function Intro() {
  return <About title={title} actionButton={actionButton} />
}
