import AppBar from '@/components/app-bar'

export default function Error() {
  return (
    <>
      <AppBar />
      <div className='flex w-full justify-center'>
        <div className='flex flex-col max-w-lg items-center text-center pt-10 space-y-4'>
          <p className='text-xl'>Ruh roh, something went wrong!</p>
          <p className='text-muted-foreground'>
            Please try again. We are monitoring recurring issues so if your issue persists, we hope to have it
            resolved soon.
          </p>
        </div>
      </div>
    </>
  )
}
