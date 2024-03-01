import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className='p-2 grid gap-2 md:grid-cols-3 md:p-12 md:gap-6'>
      <div className='flex items-center space-x-4'>
        <Skeleton className='h-12 w-12 rounded-full' />
        <div className='space-y-2'>
          <Skeleton className='h-4 w-[250px]' />
          <Skeleton className='h-4 w-[200px]' />
        </div>
      </div>
    </div>
  )
}
