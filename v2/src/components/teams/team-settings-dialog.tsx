import { CurrentTeamCard, type TeamMember } from '#/components/teams/current-team-card.tsx'
import { MyTeamsCard, type MyTeam } from '#/components/teams/my-teams-card.tsx'
import { ScoringSystemCard } from '#/components/scoring-system-card.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs.tsx'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Team admin, off the dashboard.
 *
 * WHY IT MOVED. Asked which questions the dashboard should answer fastest,
 * the owner selected five and pointedly did not select team admin -- yet
 * CurrentTeamCard, MyTeamsCard and ScoringSystemCard held two of the three
 * columns under the scores table, because v1 held it that way. The carving
 * was inherited, not chosen, and it gave the most room to the one job nobody
 * wants done daily.
 *
 * THE COMPONENTS ARE HOSTED, NOT REWRITTEN. Every prop below is one
 * routes/app.tsx already passes to CurrentTeamCard, MyTeamsCard or
 * ScoringSystemCard; this file is a shell and a tab strip, nothing more.
 *
 * PROPS ARE WRITTEN OUT EXPLICITLY rather than composed with `Omit`/`Pick`
 * over `React.ComponentProps<typeof X>`. There are only three call sites
 * feeding this dialog and about ten props between them, all visible in
 * routes/app.tsx; enumerating them is less risky than fighting the compiler
 * over a derived type, and it keeps this file readable without following an
 * import to see what it accepts.
 *
 * NOTHING RENDERS THIS DIALOG YET. `routes/app.tsx` still renders the three
 * cards inline; wiring this shell in (and retiring that inline rendering) is
 * Task 9.
 */
export function TeamSettingsDialog({
  open,
  onOpenChange,
  teamId,
  name,
  members,
  isOwner,
  myPlayerId,
  onEditSettings,
  onLeft,
  month,
  isPro,
  teams,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: Id<'teams'>
  // CurrentTeamCard (Members tab)
  name: string
  members: Array<TeamMember>
  isOwner: boolean
  myPlayerId: string | null
  onEditSettings: () => void
  onLeft: () => void
  // ScoringSystemCard (Scoring tab) -- isOwner is shared with CurrentTeamCard
  month: string
  isPro: boolean
  // MyTeamsCard (My teams tab)
  teams: Array<MyTeam>
  onDeleted: (teamId: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Team settings</DialogTitle>
          <DialogDescription>Members, your teams, and how this team scores.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="teams">My teams</TabsTrigger>
            <TabsTrigger value="scoring">Scoring</TabsTrigger>
          </TabsList>
          <TabsContent value="members">
            <CurrentTeamCard
              teamId={teamId}
              name={name}
              members={members}
              isOwner={isOwner}
              myPlayerId={myPlayerId}
              onEditSettings={onEditSettings}
              onLeft={onLeft}
            />
          </TabsContent>
          <TabsContent value="teams">
            <MyTeamsCard teams={teams} onDeleted={onDeleted} />
          </TabsContent>
          <TabsContent value="scoring">
            <ScoringSystemCard teamId={teamId} month={month} isPro={isPro} isOwner={isOwner} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

export default TeamSettingsDialog
