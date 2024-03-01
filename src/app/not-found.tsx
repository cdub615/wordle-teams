export default function NotFound() {
  return (
    <div className='flex w-full justify-center'>
      <div className='flex flex-col max-w-lg items-center text-center pt-10 space-y-4'>
        <p className='text-xl'>Page Not Found</p>
        <p className='text-muted-foreground'>
          Back to the <a href='/'>safety</a>
        </p>
      </div>
    </div>
  )
}