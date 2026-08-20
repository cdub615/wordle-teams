import { Plus } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card.tsx'

/**
 * What a signed-in player with no teams sees.
 *
 * NOT a port of v1's Intro, which renders the whole marketing About component
 * with an animated gradient wordmark and a button on it. v2 already carries
 * that copy at /about, amendment A7 makes the onboarding surface a sanctioned
 * exception to strict parity, and this is the exact step where 87% of prod
 * signups stall (wordle-teams-456). One card, one action.
 */
export function TeamsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle asChild>
          <h1>You&apos;re not on a team yet</h1>
        </CardTitle>
        <CardDescription>
          Create one to start tracking your Wordle scores.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onCreate} className="w-full">
          <Plus size={18} className="mr-2" />
          Create a Team
        </Button>
      </CardContent>
    </Card>
  )
}
