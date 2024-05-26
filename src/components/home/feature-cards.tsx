import { LayoutGrid, Lock, Rocket, ThumbsUp, Trophy, Users } from 'lucide-react'

export default function FeatureCards() {
  return (
    <section className='w-full py-12 md:py-24 lg:py-32 bg-secondary-foreground dark:bg-secondary'>
      <div className='container grid grid-cols-1 gap-12 px-4 md:grid-cols-2 md:gap-16 md:px-6 lg:grid-cols-3 lg:gap-20'>
        <div className='flex flex-col items-center gap-4 text-center'>
          <Users className='h-12 w-12 text-gray-50' />
          <h3 className='text-2xl font-bold text-gray-50'>Create Teams</h3>
          <p className='text-gray-400'>Invite your friends to join your Wordle team and compete together.</p>
        </div>
        <div className='flex flex-col items-center gap-4 text-center'>
          <LayoutGrid className='h-12 w-12 text-gray-50' />
          <h3 className='text-2xl font-bold text-gray-50'>Wordle Boards</h3>
          <p className='text-gray-400'>Enter your daily Wordle board and track your progress.</p>
        </div>
        <div className='flex flex-col items-center gap-4 text-center'>
          <Trophy className='h-12 w-12 text-gray-50' />
          <h3 className='text-2xl font-bold text-gray-50'>Competitive Scoring</h3>
          <p className='text-gray-400'>Using our default scoring system or your own, compete to earn the highest score and win.</p>
        </div>
        <div className='flex flex-col items-center gap-4 text-center'>
          <Rocket className='h-12 w-12 text-gray-50' />
          <h3 className='text-2xl font-bold text-gray-50'>Go Pro</h3>
          <p className='text-gray-400'>Become a Pro member to get access to unlimited months, unlimited teams, customizable scoring systems, and more.</p>
        </div>
        <div className='flex flex-col items-center gap-4 text-center'>
          <ThumbsUp className='h-12 w-12 text-gray-50' />
          <h3 className='text-2xl font-bold text-gray-50'>Easy Sign In</h3>
          <p className='text-gray-400'>No need to manage another username and password. Sign in quickly and easily with your existing accounts.</p>
        </div>
        <div className='flex flex-col items-center gap-4 text-center'>
          <Lock className='h-12 w-12 text-gray-50' />
          <h3 className='text-2xl font-bold text-gray-50'>Privacy</h3>
          <p className='text-gray-400'>We take your privacy seriously. We only collect what we need for a seamless sign in experience, and we never sell or share your user data.</p>
        </div>
      </div>
    </section>
  )
}
