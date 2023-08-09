import { addBoard } from '@/app/server-actions'
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import * as z from 'zod'

const FormSchema = z.object({
  name: z.string().min(2),
  playWeekends: z.boolean().default(false).optional(),
})

const AddBoard = ({ setAddBoardOpen }: { setAddBoardOpen: (open: boolean) => void }) => {
  const [answer, setAnswer] = useState('')
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
  })

  const onSubmit = (data: z.infer<typeof FormSchema>) => {
    addBoard(data)
    toast({
      title: 'You submitted the following values:',
      description: (
        <pre className='mt-2 w-[340px] rounded-md bg-slate-950 p-4'>
          <code className='text-white'>{JSON.stringify(data, null, 2)}</code>
        </pre>
      ),
    })
    setAddBoardOpen(false)
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add Board</DialogTitle>
        <DialogDescription>Enter the day&apos;s answer and your guesses</DialogDescription>
      </DialogHeader>
      <div className="flex items-center space-x-4">
        <Label htmlFor='answer'>Today&apos;s Answer</Label>
        <Input
          name='answer'
          className='w-24'
          placeholder={`Today's answer`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          maxLength={5}
        />
      </div>
      {answer && answer.length >= 5 && (
        <div className='flex w-full justify-center p-6'>
          <div className='grid grid-cols-5 gap-1 w-80'>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase bg-green-700'>S</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
            <div className='border h-16 flex justify-center items-center text-4xl uppercase'>s</div>
          </div>
        </div>
      )}

      {/* <Form {...form}>
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
      </Form> */}
    </DialogContent>
  )
}

export default AddBoard
