import AppBar from '@/components/app-bar/app-bar-base'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex flex-col w-full'>
      <AppBar />
      {children}
    </div>
  )
}
