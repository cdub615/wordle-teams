export default function DashboardSkeleton() {
  return (
    <div className='flex flex-col w-full py-24 bg-black'>
      <div className='flex flex-col gap-4 w-full'>
        <div className='animate-pulse flex justify-center'>
          <div className='w-full max-w-5xl h-[695px] rounded-lg bg-gray-900' />
        </div>
        <div className='animate-pulse flex justify-center mt-10'>
          <div className='w-32 h-12 rounded-lg bg-gray-900' />
        </div>
      </div>
    </div>
  )
}