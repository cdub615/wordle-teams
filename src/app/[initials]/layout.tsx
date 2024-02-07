import AppBar from '@/components/app-bar'
import { ScrollArea } from '@/components/ui/scroll-area'

export default function LoggedInLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='h-screen flex flex-col'>
      <AppBar variant='top' />
      <ScrollArea className='flex-grow'>
        <main>{children}</main>
      </ScrollArea>
      <AppBar variant='bottom' />
    </div>
  )
}
