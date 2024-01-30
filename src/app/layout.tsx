import BottomBar from '@/components/bottom-bar'
import ThemeProvider from '@/components/theme-provider'
import TopBar from '@/components/top-bar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Toaster } from '@/components/ui/sonner'
import Welcome from '@/components/welcome'
import { Database } from '@/lib/database.types'
import { cn, getSession } from '@/lib/utils'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import type { Metadata } from 'next'
import { AxiomWebVitals } from 'next-axiom'
import { Inter } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'

export const dynamic = 'force-dynamic'

const inter = Inter({ subsets: ['latin'] })
const rootClasses = cn(inter.className, '@container/root min-h-screen')

export const metadata: Metadata = {
  title: 'Wordle Teams: Track, Challenge, and Dominate with Friends',
  description:
    'Wordle Teams lets you compete with friends by tracking and comparing your Wordle scores, adding a competitive edge to the popular word-guessing game. Stay ahead of the competition, enjoy friendly rivalry, and prove your Wordle mastery with this exciting score-tracking app. Revive the Wordle craze and bring your A-game to the ultimate word-guessing showdown with Wordle Teams!',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerComponentClient<Database>({ cookies })
  const session = await getSession(supabase)
  return (
    <html lang='en' suppressHydrationWarning>
      <AxiomWebVitals />
      <body className={rootClasses}>
        <ThemeProvider attribute='class' defaultTheme='system' enableSystem>
          {!session ? (
            <Welcome />
          ) : (
            <div className='h-screen flex flex-col'>
              <TopBar />
              <ScrollArea className='flex-grow'>
                <main>{children}</main>
              </ScrollArea>
              <BottomBar />
            </div>
          )}
          <Toaster />
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
