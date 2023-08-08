import BottomBar from '@/components/bottom-bar'
import ThemeProvider from '@/components/theme-provider'
import TopBar from '@/components/top-bar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Toaster } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })
const rootClasses = cn(inter.className, '@container/root min-h-screen')

export const metadata: Metadata = {
  title: 'Wordle Teams',
  description: 'Keep score among friends to establish Wordle bragging rights',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body className={rootClasses}>
        <ThemeProvider attribute='class' defaultTheme='system' enableSystem>
          <div className='h-screen flex flex-col'>
            <TopBar />
            <ScrollArea className='flex-grow'>
              <main>{children}</main>
            </ScrollArea>
            <BottomBar />
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
