'use client'

import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { baseUrl } from '@/lib/utils'
import Github from './oauth-icons/github'

export function GitHubLogin() {
  const supabase = createClient()
  const handleGitHubLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${baseUrl}/auth/callback`,
      },
    })
  }
  return (
    <Button type='button' onClick={handleGitHubLogin} variant={'outline'} className='py-6'>
      <Github className='mr-2 h-5 w-5' />
      <span className='sr-only'>Sign in with GitHub</span>
      Sign in with GitHub
    </Button>
  )
}
