'use client'

import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { createClient } from '@/lib/supabase/client'
import { User } from '@/lib/types'
import { format, parse } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { log } from 'next-axiom'
import { Dispatch, SetStateAction, useTransition } from 'react'
import { toast } from 'sonner'

type BoardEntryRemindersProps = {
  user: User
  setUser: Dispatch<SetStateAction<User>>
}

export default function BoardEntryReminders({ user, setUser }: BoardEntryRemindersProps) {
  const supabase = createClient()
  const { id: userId, reminderDeliveryMethods, reminderDeliveryTime, hasPwa } = user

  const [togglingEmail, startTogglingEmail] = useTransition()
  const [togglingPush, startTogglingPush] = useTransition()
  const [updatingDeliveryTime, startUpdatingDeliveryTime] = useTransition()

  const handleUpdateMethods = async (checked: boolean, method: 'email' | 'push') => {
    let updatedMethods: string[] = []
    if (!checked && reminderDeliveryMethods.includes(method))
      updatedMethods = reminderDeliveryMethods.filter((m) => m !== method)
    else if (checked && !reminderDeliveryMethods.includes(method))
      updatedMethods = [...reminderDeliveryMethods, method]

    const { error } = await supabase
      .from('players')
      .update({ reminder_delivery_methods: updatedMethods })
      .eq('id', userId)

    if (error) {
      log.error('Failed to update delivery methods', { error })
      toast.error('Failed to update delivery methods')
    } else {
      setUser({ ...user, reminderDeliveryMethods: updatedMethods })
      toast.success('Delivery methods updated')
    }
  }

  const toggleEmailReminders = (checked: boolean) =>
    startTogglingEmail(async () => await handleUpdateMethods(checked, 'email'))

  const togglePushReminders = (checked: boolean) =>
    startTogglingPush(async () => await handleUpdateMethods(checked, 'push'))

  const formatTime = (time: string, use24Hour: boolean = false) => {
    const date = parse(time, 'HH:mm:ss', new Date())
    const formatString = use24Hour ? 'HH:mm' : 'h:mm a'
    return format(date, formatString)
  }

  const handleUpdateDeliveryTime = async (time: string) => {
    startUpdatingDeliveryTime(async () => {
      const { error } = await supabase.from('players').update({ reminder_delivery_time: time }).eq('id', userId)
      if (error) toast.error('Failed to update delivery time')
      else {
        setUser({ ...user, reminderDeliveryTime: time })
        toast.success('Delivery time updated')
      }
    })
  }

  return (
    <div className='flex flex-col space-y-2'>
      <div className='flex justify-between items-center'>
        <div className='flex flex-col space-y-1'>
          <p>Board Entry Reminder</p>
          <p className='text-sm text-muted-foreground'>Daily reminder for incomplete boards</p>
        </div>
        {updatingDeliveryTime ? (
          <Loader2 className='animate-spin' />
        ) : (
          <Select onValueChange={handleUpdateDeliveryTime} defaultValue={reminderDeliveryTime}>
            <SelectTrigger className='w-[125px]'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className='!max-h-[300px] !overflow-y-auto'>
              <SelectItem value='05:00:00'>{formatTime('05:00:00')}</SelectItem>
              <SelectItem value='06:00:00'>{formatTime('06:00:00')}</SelectItem>
              <SelectItem value='07:00:00'>{formatTime('07:00:00')}</SelectItem>
              <SelectItem value='08:00:00'>{formatTime('08:00:00')}</SelectItem>
              <SelectItem value='09:00:00'>{formatTime('09:00:00')}</SelectItem>
              <SelectItem value='10:00:00'>{formatTime('10:00:00')}</SelectItem>
              <SelectItem value='11:00:00'>{formatTime('11:00:00')}</SelectItem>
              <SelectItem value='12:00:00'>{formatTime('12:00:00')}</SelectItem>
              <SelectItem value='13:00:00'>{formatTime('13:00:00')}</SelectItem>
              <SelectItem value='14:00:00'>{formatTime('14:00:00')}</SelectItem>
              <SelectItem value='15:00:00'>{formatTime('15:00:00')}</SelectItem>
              <SelectItem value='16:00:00'>{formatTime('16:00:00')}</SelectItem>
              <SelectItem value='17:00:00'>{formatTime('17:00:00')}</SelectItem>
              <SelectItem value='18:00:00'>{formatTime('18:00:00')}</SelectItem>
              <SelectItem value='19:00:00'>{formatTime('19:00:00')}</SelectItem>
              <SelectItem value='20:00:00'>{formatTime('20:00:00')}</SelectItem>
              <SelectItem value='21:00:00'>{formatTime('21:00:00')}</SelectItem>
              <SelectItem value='22:00:00'>{formatTime('22:00:00')}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      <div className='flex space-x-4 py-2'>
        <div className='flex items-center justify-between text-muted-foreground space-x-2'>
          <Label htmlFor='emailReminders'>Email</Label>
          {togglingEmail ? (
            <Loader2 className='animate-spin' />
          ) : (
            <Switch
              name='emailReminders'
              checked={reminderDeliveryMethods.includes('email')}
              onCheckedChange={toggleEmailReminders}
            />
          )}
        </div>
        {hasPwa && (
          <div className='flex items-center justify-between text-muted-foreground space-x-2'>
            <Label htmlFor='pushReminders'>Push</Label>
            {togglingPush ? (
              <Loader2 className='animate-spin' />
            ) : (
              <Switch
                name='pushReminders'
                checked={reminderDeliveryMethods.includes('push')}
                onCheckedChange={togglePushReminders}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
