import AppBar from '@/components/app-bar'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Complete Profile',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex flex-col w-full'>
      <AppBar publicMode />
      {children}
    </div>
  )
}
