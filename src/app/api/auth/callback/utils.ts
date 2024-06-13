import { EmailOtpType } from '@supabase/supabase-js'
import { log } from 'next-axiom'
import type { NextRequest } from 'next/server'

export const parseRequest = (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  log.info(`Parsing request: ${request.url}`)
  const next = searchParams.get('next') ?? '/me'
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  return { next, code, token_hash, type }
}

export const prepareRedirect = (request: NextRequest, next: string) => {
  const redirectTo = request.nextUrl.clone()
  redirectTo.pathname = next
  redirectTo.searchParams.delete('code')
  redirectTo.searchParams.delete('token_hash')
  redirectTo.searchParams.delete('type')
  return redirectTo
}
