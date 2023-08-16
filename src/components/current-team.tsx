import InvitePlayer from '@/components/invite-player'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import AppContext from '@/lib/app-context'
import { UserPlus2 } from 'lucide-react'
import { useContext, useState } from 'react'

// TODO get invite email working
const CurrentTeam = ({ userId }: { userId: string }) => {
  const { selectedTeam } = useContext(AppContext)
  const [inviteOpen, setInviteOpen] = useState(false)
  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle>
          <div className='flex justify-between'>
            <div>{selectedTeam.name}</div>
            {userId === selectedTeam.creator && (
              <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogTrigger asChild>
                  <Button size={'icon'} variant={'outline'}>
                    <UserPlus2 size={22} />
                  </Button>
                </DialogTrigger>
                <InvitePlayer setInviteOpen={setInviteOpen} />
              </Dialog>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className='flex flex-col space-y-2'>
          {selectedTeam.players.map((player) => (
            <li key={player.fullName}>
              <div>{player.fullName}</div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export default CurrentTeam
