import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const cookieStore = cookies()
  const { initials } = await request.json()
  if (!initials || initials.length !== 2) return NextResponse.json({ error: 'Invalid initials' }, { status: 400 })

  cookieStore.set('initials', initials)
  return NextResponse.json({ success: true })
}
