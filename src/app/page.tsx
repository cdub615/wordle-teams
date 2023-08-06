import CurrentMonthScores from '@/components/current-month-scores'
import { ModeToggle } from '@/components/mode-toggle'

/*
  create team with name, search for player by email or name, and invite if not found
  have somewhere for user to add their board for the day, and they'll have to provide the answer
  have table that shows current month score for team per player per day
    allow user to change month and team displayed if they're on multiple teams
  show scoring system
  for previous months, show total scores by player in a simple card
  wall of fame, have a way for players to mark boards in either wall
  wall of shame
*/

const Home = () => {
  return (
    <>
      <ModeToggle />
      <div className='p-4 grid gap-2 @md/root:grid-cols-3 @md/root:p-12 @md/root:gap-6'>
        <CurrentMonthScores />
      </div>
    </>
  )
}

export default Home
