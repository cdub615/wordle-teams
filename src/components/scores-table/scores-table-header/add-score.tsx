import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const AddScore = ({ setAddScoreOpen }: { setAddScoreOpen: (open: boolean) => void }) => (
  <DialogContent className='sm:max-w-[425px]'>
    <DialogHeader>
      <DialogTitle>Add Score</DialogTitle>
      <DialogDescription>
        Enter either your number of attempts for the day or the day&apos;s answer and your board
      </DialogDescription>
    </DialogHeader>
    <div className='grid gap-4 py-4'>
      <div className='grid grid-cols-4 items-center gap-4'>
        <Label htmlFor='name' className='text-right'>
          Team Name
        </Label>
        <Input id='name' value='Pedro Duarte' className='col-span-3' />
      </div>
      <div className='grid grid-cols-4 items-center gap-4'>
        <Label htmlFor='playWeekends' className=''>
          Play Weekends
        </Label>
        <Input id='playWeekends' value='@peduarte' className='col-span-3' />
      </div>
    </div>
    <DialogFooter>
      <Button type='submit'>Save</Button>
    </DialogFooter>
  </DialogContent>
)

export default AddScore
