'use client'

import { AlertDialogFooter } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/use-toast'
import { zodResolver } from '@hookform/resolvers/zod'
import { log } from 'next-axiom'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import * as z from 'zod'

const FormSchema = z.object({
  name: z.string().min(2),
  playWeekends: z.boolean().default(false).optional(),
})

const CreateTeamForm = () => {
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
      toast({
        title: `Successfully created ${name}`,
      })
      router.replace('/')
    } else {
      log.error(`An unexpected error occurred while creating team.`, { response: await response.json() })
      form.reset()
      toast({
        title: 'Failed to create team. Please try again.',
      })
    }
  }
  return (
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
        <AlertDialogFooter>
        <Button onClick={() => router.back()} variant={'secondary'}>Cancel</Button>
          <Button type='submit'>Save</Button>
        </AlertDialogFooter>
      </form>
    </Form>
  )
}

export default CreateTeamForm
