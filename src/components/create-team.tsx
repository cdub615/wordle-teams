'use client'

import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/use-toast'
import { Team } from '@/lib/types'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { Dispatch, SetStateAction } from 'react'
import { useForm } from 'react-hook-form'
import * as z from 'zod'
import { fromNewTeamResult } from '../lib/utils'

const FormSchema = z.object({
  name: z.string().min(2),
  playWeekends: z.boolean().default(false).optional(),
})

type CreateTeamProps = {
  setCreateTeamOpen: (open: boolean) => void
  teams: Team[]
  setTeams: Dispatch<SetStateAction<Team[]>>
  setSelectedTeam: Dispatch<SetStateAction<Team>>
}

const CreateTeam = ({ setCreateTeamOpen, teams, setTeams, setSelectedTeam }: CreateTeamProps) => {
  const router = useRouter()
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: '',
      playWeekends: false,
    },
  })

  const onSubmit = async (data: z.infer<typeof FormSchema>) => {
    const { name, playWeekends } = data
    const response = await fetch(`/api/create-team`, {
      method: 'POST',
      body: JSON.stringify({ name, playWeekends }),
      headers: {
        'Content-Type': 'application/json',
      },
    })
    form.reset()
    if (response.ok) {
      const result = await response.json()
      const team = fromNewTeamResult(result)
      setTeams([...teams, team])
      setSelectedTeam(team)
      toast({
        title: `Successfully created ${name}`,
      })
    } else {
      console.log(`An unexpected error occurred while creating team: ${response.statusText}`)
      toast({
        title: 'Failed to create team. Please try again.',
      })
    }
    setCreateTeamOpen(false)
    router.refresh()
  }
  return (
    <DialogContent className='sm:max-w-[425px]'>
      <DialogHeader>
        <DialogTitle>
          {teams.length > 0 ? 'Create Team' : 'Receive Team Invite or Create a Team to get started'}
        </DialogTitle>
        <DialogDescription>
          Enter your team&apos;s name and specify whether you want to include weekend scores
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='w-full space-y-6'>
          <div className='grid gap-4 py-4'>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <div className='grid grid-cols-3 items-center gap-4'>
                    <FormLabel className='text-right'>Team Name</FormLabel>
                    <FormControl className='col-span-2'>
                      <Input {...field} />
                    </FormControl>
                  </div>
                  <FormMessage className='w-full text-center py-2' />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='playWeekends'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between p-4'>
                  <div className='grid grid-cols-3 items-center gap-4'>
                    <FormLabel className='text-right'>Play Weekends</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </div>
                </FormItem>
              )}
            />
          </div>
          <DialogFooter>
            <Button type='submit'>Save</Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  )
}

export default CreateTeam
