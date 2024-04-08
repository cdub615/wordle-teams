import { Database } from '@/lib/database.types'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { randomUUID } from 'crypto'
import { cookies } from 'next/headers'

export function createClient(cookieStore: ReturnType<typeof cookies>) {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options })
        },
      },
      global: {
        headers: {
          'X-Entity-Ref-ID': randomUUID(),
        },
      },
    }
  )
}

export function createAdminClient(cookieStore: ReturnType<typeof cookies>) {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options })
        },
      },
      global: {
        headers: {
          'X-Entity-Ref-ID': randomUUID(),
        },
      },
    }
  )
}

export function createAuthAdminClient(cookieStore: ReturnType<typeof cookies>) {
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options })
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: '', ...options })
      },
    },
    global: {
      headers: {
        'X-Entity-Ref-ID': randomUUID(),
      },
    },
  })
}
