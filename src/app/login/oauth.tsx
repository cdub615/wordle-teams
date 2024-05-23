'use client'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createClient } from '@/lib/supabase/client'
import { getOAuthProviderName } from '@/lib/utils'
import { Provider } from '@supabase/supabase-js'
import { Discord, Github, Google, Microsoft, Slack, X } from './oauth-icons'

const getRedirect = () => {
  switch (process.env.NEXT_PUBLIC_VERCEL_ENV) {
    case 'preview':
    case 'development':
      return 'https://dev.wordleteams.com/auth/callback'
    case 'local':
      return 'http://localhost:3000/auth/callback'
    default:
      return 'https://wordleteams.com/auth/callback'
  }
}

const getCreds = (redirectTo: string, provider: Provider) => {
  switch (provider) {
    case 'google':
      return {
        provider,
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      }
    case 'azure':
      return { provider, options: { redirectTo, scopes: 'email offline_access' } }
    default:
      return { provider, options: { redirectTo } }
  }
}

export default function OAuthLogin({ provider }: { provider: Provider }) {
  const supabase = createClient()
  const redirectTo = getRedirect()
  const creds = getCreds(redirectTo, provider)
  const providerName = getOAuthProviderName(provider)

  const handleLogin = async () => await supabase.auth.signInWithOAuth(creds)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type='button' onClick={handleLogin} variant={'outline'} className='py-6'>
            {provider === 'github' && <Github className='h-5 w-5' />}
            {provider === 'google' && <Google className='h-5 w-5' />}
            {provider === 'discord' && <Discord className='h-5 w-5' />}
            {provider === 'azure' && <Microsoft className='h-5 w-5' />}
            {provider === 'slack' && <Slack className='h-5 w-5' />}
            {provider === 'twitter' && <X className='h-5 w-5' />}
            <span className='sr-only'>Sign in with {providerName}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{providerName}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
