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
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { createClient } from '@/lib/supabase/client'
import { User } from '@/lib/types'
import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { Loader2, Share } from 'lucide-react'
import { log } from 'next-axiom'
import { Dispatch, SetStateAction, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
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
  const isSmallScreen = useMediaQuery('(max-width: 640px)')

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

  const options = [
    {
      label: 'North America',
      items: [
        { value: 'America/New_York', label: 'Eastern Standard Time (EST)', shortLabel: 'EST' },
        { value: 'America/Chicago', label: 'Central Standard Time (CST)', shortLabel: 'CST' },
        { value: 'America/Denver', label: 'Mountain Standard Time (MST)', shortLabel: 'MST' },
        { value: 'America/Los_Angeles', label: 'Pacific Standard Time (PST)', shortLabel: 'PST' },
        { value: 'America/Anchorage', label: 'Alaska Standard Time (AKST)', shortLabel: 'AKST' },
        { value: 'Pacific/Honolulu', label: 'Hawaii Standard Time (HST)', shortLabel: 'HST' },
      ],
    },
    {
      label: 'Europe & Africa',
      items: [
        { value: 'Europe/London', label: 'Greenwich Mean Time (GMT)', shortLabel: 'GMT' },
        { value: 'Europe/Paris', label: 'Central European Time (CET)', shortLabel: 'CET' },
        { value: 'Europe/Athens', label: 'Eastern European Time (EET)', shortLabel: 'EET' },
        { value: 'Europe/Lisbon', label: 'Western European Summer Time (WEST)', shortLabel: 'WEST' },
        { value: 'Africa/Harare', label: 'Central Africa Time (CAT)', shortLabel: 'CAT' },
        { value: 'Africa/Nairobi', label: 'East Africa Time (EAT)', shortLabel: 'EAT' },
      ],
    },
    {
      label: 'Asia',
      items: [
        { value: 'Europe/Moscow', label: 'Moscow Time (MSK)', shortLabel: 'MSK' },
        { value: 'Asia/Kolkata', label: 'India Standard Time (IST)', shortLabel: 'IST' },
        { value: 'Asia/Shanghai', label: 'China Standard Time (CST)', shortLabel: 'CST' },
        { value: 'Asia/Tokyo', label: 'Japan Standard Time (JST)', shortLabel: 'JST' },
        { value: 'Asia/Seoul', label: 'Korea Standard Time (KST)', shortLabel: 'KST' },
        { value: 'Asia/Makassar', label: 'Indonesia Central Standard Time (WITA)', shortLabel: 'WITA' },
      ],
    },
    {
      label: 'Australia & Pacific',
      items: [
        { value: 'Australia/Perth', label: 'Australian Western Standard Time (AWST)', shortLabel: 'AWST' },
        { value: 'Australia/Darwin', label: 'Australian Central Standard Time (ACST)', shortLabel: 'ACST' },
        { value: 'Australia/Sydney', label: 'Australian Eastern Standard Time (AEST)', shortLabel: 'AEST' },
        { value: 'Pacific/Auckland', label: 'New Zealand Standard Time (NZST)', shortLabel: 'NZST' },
        { value: 'Pacific/Fiji', label: 'Fiji Time (FJT)', shortLabel: 'FJT' },
      ],
    },
    {
      label: 'South America',
      items: [
        { value: 'America/Argentina/Buenos_Aires', label: 'Argentina Time (ART)', shortLabel: 'ART' },
        { value: 'America/La_Paz', label: 'Bolivia Time (BOT)', shortLabel: 'BOT' },
        { value: 'America/Sao_Paulo', label: 'Brasilia Time (BRT)', shortLabel: 'BRT' },
        { value: 'America/Santiago', label: 'Chile Standard Time (CLT)', shortLabel: 'CLT' },
      ],
    },
  ]

  const displayValue = useMemo(() => {
    for (const group of options) {
      const selectedOption = group.items.find((item) => item.value === timeZone)
      if (selectedOption) {
        return isSmallScreen ? selectedOption.shortLabel : selectedOption.label
      }
    }
    return 'Select a timezone'
  }, [timeZone, isSmallScreen])

  return (
    <DialogContent className='w-11/12 px-3 py-4 md:p-6'>
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
                    <SelectTrigger className='w-[115px] md:w-[280px]'>
                      <SelectValue>{displayValue}</SelectValue>
                    </SelectTrigger>
                    <SelectContent className='!max-h-[300px] !overflow-y-auto'>
                      {options.map((group, index) => (
                        <SelectGroup key={index}>
                          <SelectLabel>{group.label}</SelectLabel>
                          {group.items.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
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
