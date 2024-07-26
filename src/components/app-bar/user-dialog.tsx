'use client'

import { DialogContent } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { User } from '@/lib/types'
import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { Loader2, Share } from 'lucide-react'
import { log } from 'next-axiom'
import { Dispatch, SetStateAction, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { createClient } from '../../lib/supabase/client'
import BoardEntryReminders from './board-entry-reminders'

type UserDialogProps = {
  user: User
  setUser: Dispatch<SetStateAction<User>>
  defaultTab: 'notifications' | 'install'
}

export default function UserDialog({ user, setUser, defaultTab }: UserDialogProps) {
  const supabase = createClient()
  const { id: userId, timeZone } = user
  const [updatingTimeZone, startTransition] = useTransition()

  const handleUpdateTimeZone = async (timeZone: string) => {
    startTransition(async () => {
      const { error } = await supabase.from('players').update({ time_zone: timeZone }).eq('id', userId)
      if (error) {
        log.error('Failed to update time zone', { error })
        toast.error('Failed to update time zone')
      } else {
        setUser({ ...user, timeZone })
        toast.success('Time zone updated')
      }
    })
  }

  return (
    <DialogContent className='w-11/12 px-2 py-4 md:p-6'>
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value='notifications'>Notifications</TabsTrigger>
          <TabsTrigger value='install'>Install Guide</TabsTrigger>
        </TabsList>
        <TabsContent value='notifications'>
          <div className='flex flex-col space-y-1.5 py-4'>
            <h3 className='text-2xl font-semibold leading-none tracking-tight'>Notification Settings</h3>
            <p className='text-sm text-muted-foreground'>Review and manage your notification settings</p>
          </div>
          <div className='py-6 pt-6 flex flex-col space-y-8'>
            {timeZone && (
              <div className='flex items-center justify-between'>
                <div>Time Zone</div>
                {updatingTimeZone ? (
                  <Loader2 className='animate-spin' />
                ) : (
                  <Select onValueChange={handleUpdateTimeZone} defaultValue={timeZone}>
                    <SelectTrigger className='w-[280px]'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className='!max-h-[300px] !overflow-y-auto'>
                      <SelectGroup>
                        <SelectLabel>North America</SelectLabel>
                        <SelectItem value='America/New_York'>Eastern Standard Time (EST)</SelectItem>
                        <SelectItem value='America/Chicago'>Central Standard Time (CST)</SelectItem>
                        <SelectItem value='America/Denver'>Mountain Standard Time (MST)</SelectItem>
                        <SelectItem value='America/Los_Angeles'>Pacific Standard Time (PST)</SelectItem>
                        <SelectItem value='America/Anchorage'>Alaska Standard Time (AKST)</SelectItem>
                        <SelectItem value='Pacific/Honolulu'>Hawaii Standard Time (HST)</SelectItem>
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Europe & Africa</SelectLabel>
                        <SelectItem value='Europe/London'>Greenwich Mean Time (GMT)</SelectItem>
                        <SelectItem value='Europe/Paris'>Central European Time (CET)</SelectItem>
                        <SelectItem value='Europe/Athens'>Eastern European Time (EET)</SelectItem>
                        <SelectItem value='Europe/Lisbon'>Western European Summer Time (WEST)</SelectItem>
                        <SelectItem value='Africa/Harare'>Central Africa Time (CAT)</SelectItem>
                        <SelectItem value='Africa/Nairobi'>East Africa Time (EAT)</SelectItem>
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Asia</SelectLabel>
                        <SelectItem value='Europe/Moscow'>Moscow Time (MSK)</SelectItem>
                        <SelectItem value='Asia/Kolkata'>India Standard Time (IST)</SelectItem>
                        <SelectItem value='Asia/Shanghai'>China Standard Time (CST)</SelectItem>
                        <SelectItem value='Asia/Tokyo'>Japan Standard Time (JST)</SelectItem>
                        <SelectItem value='Asia/Seoul'>Korea Standard Time (KST)</SelectItem>
                        <SelectItem value='Asia/Makassar'>Indonesia Central Standard Time (WITA)</SelectItem>
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Australia & Pacific</SelectLabel>
                        <SelectItem value='Australia/Perth'>Australian Western Standard Time (AWST)</SelectItem>
                        <SelectItem value='Australia/Darwin'>Australian Central Standard Time (ACST)</SelectItem>
                        <SelectItem value='Australia/Sydney'>Australian Eastern Standard Time (AEST)</SelectItem>
                        <SelectItem value='Pacific/Auckland'>New Zealand Standard Time (NZST)</SelectItem>
                        <SelectItem value='Pacific/Fiji'>Fiji Time (FJT)</SelectItem>
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>South America</SelectLabel>
                        <SelectItem value='America/Argentina/Buenos_Aires'>Argentina Time (ART)</SelectItem>
                        <SelectItem value='America/La_Paz'>Bolivia Time (BOT)</SelectItem>
                        <SelectItem value='America/Sao_Paulo'>Brasilia Time (BRT)</SelectItem>
                        <SelectItem value='America/Santiago'>Chile Standard Time (CLT)</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <Separator className='my-4' />
            <BoardEntryReminders user={user} setUser={setUser} />
          </div>
        </TabsContent>
        <TabsContent value='install'>
          <div className='flex flex-col space-y-1.5 px-2 py-6 md:p-6'>
            <h3 className='text-2xl font-semibold leading-none tracking-tight'>Installation</h3>
            <p className='text-sm text-muted-foreground'>To install Wordle Teams as an app</p>
          </div>
          <div className='px-2 py-6 md:px-6 md:pb-6 pt-0'>
            <ul className='list-decimal text-sm md:text-base ml-4'>
              <li className='mb-2'>
                Tap the three-dot menu icon{' '}
                <span className='inline-flex'>
                  <DotsHorizontalIcon />
                </span>{' '}
                or the Share icon <Share className='inline-flex' size={18} />
              </li>
              <li className='mb-2'>Select &quot;Add to Home Screen&quot; or &quot;Install app&quot;</li>
              <li>Confirm by tapping &quot;Install&quot; or &quot;Add&quot;</li>
            </ul>
          </div>
        </TabsContent>
      </Tabs>
    </DialogContent>
  )
}
