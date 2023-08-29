import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const POST = async (req: NextRequest, res: NextResponse) => {
  const { teamId } = await req.json()
  cookies().set('teamId', teamId)
  return NextResponse.json(true)
}

export { POST }
