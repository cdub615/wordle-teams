'use client'

import { getCheckoutUrl } from '@/app/me/actions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTeams } from '@/lib/contexts/teams-context'
import { ChevronDown, Loader2, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import CreateTeam from './create-team'

export default function TeamsDropdown() {
  const [loading, setLoading] = useState(false)
  const { teams, teamId, setTeamId, user } = useTeams()
  const proMember = user.memberStatus === 'pro'
  const selectedTeam = teams.find((t) => t.id === teamId)
  const selectedName = selectedTeam?.name ?? null
  const teamName = !selectedName
    ? 'No team selected'
    : selectedName.length > 15
      ? `${selectedName.slice(0, 15)}...`
      : selectedName
  const handleTeamChange = (t: string) => setTeamId(Number.parseInt(t))
  const handleUpgrade = async () => {
    setLoading(true)
    const { checkoutUrl, error } = await getCheckoutUrl(user)
    if (error) toast.error(error)
    else if (checkoutUrl) window.LemonSqueezy.Url.Open(checkoutUrl)
    setLoading(false)
  }


  if (teams)
    return (
      <Dialog>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='outline' className='text-xs px-2 max-w-[9.5rem] md:text-sm md:px-4 md:max-w-none'>
              {loading ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <>
                  {teamName} <ChevronDown className='ml-1 md:ml-2 h-4 w-4' />
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuLabel>Change Team</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={`${teamId}`} onValueChange={handleTeamChange}>
              {teams.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={`${option.id}`}>
                  {option.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            {!proMember && teams.length >= 2 ? (
              <DropdownMenuItem onClick={handleUpgrade}>
                <div className='flex items-center w-full space-x-2'>
                  <Sparkles size={18} />
                  <span>Upgrade for more</span>
                </div>
              </DropdownMenuItem>
            ) : (
              <DialogTrigger asChild className='w-full'>
                <DropdownMenuItem>
                  <div className='flex items-center w-full space-x-2'>
                    <Plus size={18} />
                    <span>New Team</span>
                  </div>
                </DropdownMenuItem>
              </DialogTrigger>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <CreateTeam />
      </Dialog>
    )
}
