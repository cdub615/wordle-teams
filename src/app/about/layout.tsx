import AppBar from '@/components/app-bar'
import { ScrollArea } from '@/components/ui/scroll-area'

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='h-screen flex flex-col'>
      <AppBar />
      <ScrollArea className='flex-grow'>
        <section>{children}</section>
      </ScrollArea>
    </div>
  )
}
