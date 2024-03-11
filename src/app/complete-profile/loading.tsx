import {Skeleton} from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className='flex justify-center mt-24 px-6'>
      <div className='max-w-lg'>
        <div className='text-3xl md:text-4xl text-center font-semibold leading-loose'>Complete Your Profile</div>
        <div className='text-muted-foreground text-center'>Please provide your name to complete your profile</div>
          <div className='flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-6 my-6'>
            <div className='w-full py-4'>
              <Skeleton className='h-12 rounded-lg' />
            </div>
            <div className='w-full py-4'>
              <Skeleton className='h-12 rounded-lg' />
            </div>
          </div>
          <div className='flex justify-end'>
            <Skeleton className='h-10 w-20 rounded-lg' />
          </div>
      </div>
    </div>
  )
}