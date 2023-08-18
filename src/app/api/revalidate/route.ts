import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const GET = async () => {
  revalidatePath('/')

  return NextResponse.json(true)
}

export { GET }
