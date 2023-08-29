'use client'

import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/use-toast'
import { Team, teams } from '@/lib/types'
import { zodResolver } from '@hookform/resolvers/zod'
import { log } from 'next-axiom'
import { useRouter } from 'next/navigation'
import { Form, useForm } from 'react-hook-form'
import * as z from 'zod'

const FormSchema = z.object({
  email: z.string().email('Please enter a valid email that includes @ and .'),
})

type InviteDialogProps = {
  team: teams
  playerIds: string[]
}

export default function InviteDialog({ team, playerIds }: InviteDialogProps) {
  const router = useRouter()
  const selectedTeam = Team.prototype.fromDbTeam(team)
  const { id: teamId, name: teamName, invited } = selectedTeam
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      email: '',
    },
  })

  const onSubmit = async (data: z.infer<typeof FormSchema>) => {
    const { email } = data

    const response = await fetch(`/api/invite-player`, {
      method: 'POST',
      body: JSON.stringify({ teamId, teamName, playerIds, invited, email }),
      headers: {
        'Content-Type': 'application/json',
      },
    })
    form.reset()
    if (response.ok) {
      toast({
        title: `Invite sent. If player hasn't yet signed up they'll be added upon signup.`,
      })
    } else {
      log.error(`An unexpected error occurred while inviting player: ${response.statusText}`, {
        response: await response.json(),
      })
      toast({
        title: 'Failed to invite player. Please try again.',
      })
    }
    router.refresh()
  }

  return (
    <DialogContent className='sm:max-w-[425px]'>
      <DialogHeader>
        <DialogTitle>Invite Player to Team</DialogTitle>
        <DialogDescription>Add player by email address</DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='w-full space-y-6'>
          <div className='grid gap-4 py-4'>
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <div className='grid grid-cols-3 items-center gap-4'>
                    <FormLabel className='text-right'>Email</FormLabel>
                    <FormControl className='col-span-2'>
                      <Input {...field} />
                    </FormControl>
                  </div>
                  <FormMessage className='w-full text-center py-2' />
                </FormItem>
              )}
            />
          </div>
          <DialogFooter>
            <Button type='submit'>Submit</Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  )
}
