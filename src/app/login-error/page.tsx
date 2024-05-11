import { cookies } from 'next/headers'

export default async function Page() {
  const clear = async () => {
    const cookieStore = cookies()
    cookieStore.getAll().forEach((key) => {
      cookieStore.delete(key)
    })
  }
  await clear()
  return (
    <div className='flex justify-center mt-24 px-6'>
      <div className='max-w-lg'>
        <div className='text-3xl md:text-4xl text-center font-semibold leading-loose'>Login / Signup Failed</div>
        <div className='text-muted-foreground text-center'>Please try again</div>
        <div className='text-sm text-muted-foreground text-center'>
          Hint: some email clients open a preview window when you copy the link which makes it expire. If possible,
          click the button in the email.
        </div>
      </div>
    </div>
  )
}
