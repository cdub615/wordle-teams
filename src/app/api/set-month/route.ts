import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const POST = async (req: NextRequest) => {
  const cookieStore = cookies()
  const body = await req.json()
  cookieStore.set('month', body.newMonth)
  return NextResponse.json(true)
}

export { POST }
