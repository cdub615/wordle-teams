import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { ConfirmPopover } from '#/components/confirm-popover.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import type { Id } from '../../../convex/_generated/dataModel'

export type MyTeam = {
  id: string
  name: string
  isOwner: boolean
  members: Array<{ id: string; firstName: string; lastName: string }>
}

/**
 * Every team you are on, with its members. Ports v1's my-teams.tsx.
 *
 * Delete is owner-only in the UI, as in v1, and now also in the mutation.
 * Deleting cascades to the team's winner rows and scoring versions but leaves
 * every board alone — a board belongs to a player, not to a team.
 */
export function MyTeamsCard({
  teams,
  onDeleted,
  className,
}: {
  teams: Array<MyTeam>
  onDeleted: (teamId: string) => void
  className?: string
}) {
  const remove = useMutation({ mutationFn: useConvexMutation(api.teams.deleteTeam) })
  const [pendingId, setPendingId] = useState<string | null>(null)
  // Which team's popover is open, if any. Controlled so a successful delete
  // can close it explicitly (see handleDelete below) instead of relying on
  // the team's <li> unmounting once the Convex subscription re-pushes the
  // team list without it — that unmount is a second, independent async hop,
  // and in the gap the popover would otherwise sit open over an
  // already-deleted team.
  const [openId, setOpenId] = useState<string | null>(null)

  const handleDelete = async (teamId: string) => {
    setPendingId(teamId)
    try {
      await remove.mutateAsync({ teamId: teamId as Id<'teams'> })
      toast.success('Successfully deleted team')
      setOpenId(null)
      onDeleted(teamId)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Team deletion failed, please try again'))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle asChild>
          <h2>My Teams</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col space-y-2">
          {teams.map((team, index) => (
            <li key={team.id} className="min-w-0">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <span className="min-w-0 truncate">{team.name}</span>
                <div className="flex items-start gap-2">
                  <ul className="text-right">
                    {team.members.map((member) => (
                      <li key={member.id}>
                        <span>{member.firstName}</span>
                        <span className="hidden md:inline">&nbsp;{member.lastName}</span>
                      </li>
                    ))}
                  </ul>
                  {team.isOwner && (
                    <ConfirmPopover
                      open={openId === team.id}
                      onOpenChange={(next) => setOpenId(next ? team.id : null)}
                      trigger={
                        <Button variant="ghost" aria-label={`Delete ${team.name}`}>
                          <Trash2 size={16} className="text-danger" />
                        </Button>
                      }
                      message={`Delete ${team.name}?`}
                      confirmLabel="Delete"
                      confirmSize="sm"
                      pending={pendingId === team.id}
                      onConfirm={() => handleDelete(team.id)}
                    />
                  )}
                </div>
              </div>
              {index < teams.length - 1 && <Separator className="mt-2" />}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
