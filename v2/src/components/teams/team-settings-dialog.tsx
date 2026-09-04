import { Suspense } from 'react'
import { CurrentTeamCard, type TeamMember } from '#/components/teams/current-team-card.tsx'
import { MyTeamsCard, type MyTeam } from '#/components/teams/my-teams-card.tsx'
import { ScoringSystemCard } from '#/components/scoring-system-card.tsx'
import { ScoringSystemCardSkeleton } from '#/components/dashboard-skeletons.tsx'
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
 * The three tabs this dialog hosts. Named and typed the same way
 * settings-dialog.tsx's `SettingsTab` is -- a union of the literal values,
 * not `string` -- so a typo in a caller's `defaultTab` is a compile error
 * instead of a tab strip that silently opens on nothing selected.
 */
export type TeamSettingsTab = 'members' | 'teams' | 'scoring'

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
 * `defaultTab` DEFAULTS TO `'members'` BUT IS NOT ALWAYS THAT. Task 9 wires
 * ScoringLegend's Edit control to open this dialog straight on `'scoring'` --
 * without that, Edit would land on Members, next to chips it has nothing to
 * do with. Like settings-dialog.tsx's `defaultTab`, this is an UNCONTROLLED
 * `Tabs.defaultValue`, not a controlled `value`: once open, which tab is
 * showing is this dialog's own business. Unlike settings-dialog.tsx, this one
 * has a fallback rather than requiring every caller to pick -- verified
 * (node_modules/@radix-ui/react-dialog, DialogContent) that Radix's
 * `DialogContent` sits behind `<Presence present={forceMount || open}>` and we
 * pass no `forceMount`, so it UNMOUNTS on close; that takes the nested `Tabs`
 * with it, so `defaultValue` re-applies fresh on every open rather than
 * remembering whatever tab was last showing.
 *
 * NOTHING RENDERS THIS DIALOG YET. `routes/app.tsx` still renders the three
 * cards inline; wiring this shell in (and retiring that inline rendering) is
 * Task 9.
 */
export function TeamSettingsDialog({
  open,
  onOpenChange,
  teamId,
  defaultTab = 'members',
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
  defaultTab?: TeamSettingsTab
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
      {/*
        `w-11/12 rounded-lg` MATCHES THE OTHER FIVE CONTENT DIALOGS
        (update-team-dialog, create-team-dialog, invite-player-dialog,
        scoring-system-editor, settings-dialog), each pairing the two for the
        same reason settings-dialog.tsx's comment gives: ui/dialog.tsx only
        rounds at `sm:` and up, so a panel left at the shadcn default is
        square-cornered exactly where narrowing it would look broken.
        board-entry/button.tsx and monthly-winner-celebration.tsx are the only
        two `DialogContent`s that skip this, and neither is a counterexample
        for this dialog: board-entry's bare `DialogContent` only renders on
        `isDesktop` (mobile gets a Sheet instead, never this component), and
        monthly-winner-celebration's content is a couple lines plus confetti,
        short enough that full-bleed costs nothing. This dialog hosts three
        admin cards' worth of content, the same shape as the five inset
        dialogs, not the two thin ones -- so it takes their pairing.
      */}
      <DialogContent className="w-11/12 rounded-lg max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Team settings</DialogTitle>
          <DialogDescription>Members, your teams, and how this team scores.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={defaultTab}>
          {/*
            STICKY, because DialogContent above is the ONLY scrolling
            container here -- the header and the whole Tabs tree scroll
            together inside it. Team size is unbounded, so a long member list
            pushing this tab strip out of view is the ordinary case for a
            large team, not an edge case: without `sticky`, switching to My
            teams or Scoring would mean scrolling back up first. `w-full`
            (rather than leaving the default inline-flex width) so the sticky
            band covers the full row once content is scrolled under it, not
            just the width of the three triggers; `bg-muted` (inherited from
            ui/tabs.tsx, unchanged here) is an opaque token
            (`--surface-sunken`, #f4f4f5 / #1c1c1c, no alpha in either theme),
            so nothing shows through it. `z-10` keeps it above the scrolled
            content rather than merely opaque against it.
          */}
          <TabsList className="sticky top-0 z-10 w-full">
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
            {/* A LOCAL Suspense BOUNDARY, NOT ONE HIGHER UP THE TREE.
                Radix's Tabs.Content does not mount inactive tab content (no
                `forceMount` below) -- so ScoringSystemCard, which calls
                useSuspenseQuery, mounts on first switch to this tab rather
                than on dialog open. CurrentTeamCard and MyTeamsCard do not
                need the same treatment: CurrentTeamCard uses plain useQuery
                (its own comment says so, deliberately, so a member's card
                renders without waiting) and MyTeamsCard takes its data as a
                prop and calls no query hook at all -- neither suspends.
                Without this boundary, the first switch to Scoring would
                suspend up to whatever ancestor boundary exists once Task 9
                wires this dialog in, showing that boundary's larger fallback
                instead of this card's own purpose-built skeleton. */}
            <Suspense fallback={<ScoringSystemCardSkeleton />}>
              <ScoringSystemCard teamId={teamId} month={month} isPro={isPro} isOwner={isOwner} />
            </Suspense>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

export default TeamSettingsDialog
