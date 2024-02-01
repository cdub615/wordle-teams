import ThemeProvider from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { cn, getSession } from '@/lib/utils'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import type { Metadata } from 'next'
import { AxiomWebVitals } from 'next-axiom'
import { Inter } from 'next/font/google'
import { redirect } from 'next/navigation'
import './globals.css'

export const dynamic = 'force-dynamic'

const inter = Inter({ subsets: ['latin'] })
const rootClasses = cn(inter.className, '@container/root min-h-screen')

export const metadata: Metadata = {
  title: 'Wordle Teams: Track, Challenge, and Dominate with Friends',
  description:
    'Wordle Teams lets you compete with friends by tracking and comparing your Wordle scores, adding a competitive edge to the popular word-guessing game. Stay ahead of the competition, enjoy friendly rivalry, and prove your Wordle mastery with this exciting score-tracking app. Revive the Wordle craze and bring your A-game to the ultimate word-guessing showdown with Wordle Teams!',
}

export default async function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang='en' suppressHydrationWarning>
      <AxiomWebVitals />
      <body className={rootClasses}>
        <ThemeProvider attribute='class' defaultTheme='system' enableSystem>
          <main>{children}</main>
          <Toaster />
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
