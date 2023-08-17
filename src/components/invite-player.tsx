'use client'

import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/use-toast'
import AppContext from '@/lib/app-context'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dispatch, SetStateAction, useContext } from 'react'
import { useForm } from 'react-hook-form'
import * as z from 'zod'

const FormSchema = z.object({
  email: z.string().email('Please enter a valid email that includes @ and .'),
})

const InvitePlayer = ({ setInviteOpen }: { setInviteOpen: Dispatch<SetStateAction<boolean>> }) => {
  const { selectedTeam } = useContext(AppContext)
  const teamId = selectedTeam.id
  const playerIds = selectedTeam.players.map((p) => p.id)
  const invited = selectedTeam.invited
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
      body: JSON.stringify({ teamId, teamName: selectedTeam.name, playerIds, invited, email }),
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
      console.log(`An unexpected error occurred while inviting player: ${response.statusText}`)
      toast({
        title: 'Failed to invite player. Please try again.',
      })
    }
    setInviteOpen(false)
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

export default InvitePlayer
