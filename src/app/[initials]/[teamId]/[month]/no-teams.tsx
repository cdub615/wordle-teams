import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function NoTeams({ initials }: { initials: string }) {
  return (
    <div className='flex justify-center mt-10'>
      <div>
        <p className='text-lg max-w-xs text-center mx-auto'>
          Receive a Team Invite or Create a Team to get started
        </p>
        <div className='flex justify-center my-4'>
          <Link href={`/${initials}/create-team`}>
            <Button>Create Team</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
