import BottomBar from '@/components/bottom-bar'
import TopBar from '@/components/top-bar'
import { ScrollArea } from '@/components/ui/scroll-area'

export default function LoggedInLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='h-screen flex flex-col'>
      <TopBar />
      <ScrollArea className='flex-grow'>
        <main>{children}</main>
      </ScrollArea>
      <BottomBar />
    </div>
  )
}
