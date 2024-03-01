import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className='p-2 grid gap-2 md:grid-cols-3 md:p-12 md:gap-6'>
      <div className='md:col-span-3 flex w-full items-center space-x-2 md:space-x-4'>
        <Skeleton className='h-10 w-32 rounded-lg' />
        <Skeleton className='h-10 w-32 rounded-lg' />
        <Skeleton className='h-10 w-10 rounded-lg' />
        <div className='flex-grow' />
        <Skeleton className='h-10 w-10 rounded-lg' />
      </div>
      <Skeleton className='md:col-span-3 h-[175px] w-full rounded-xl' />
      <Skeleton className='h-[175px] w-full rounded-xl' />
      <Skeleton className='h-[175px] w-full rounded-xl' />
      <Skeleton className='md:row-span-3 h-[525px] w-full rounded-xl' />
    </div>
  )
}
