import { NextResponse } from 'next/server'
import { Novu } from '@novu/node'

export async function POST(request: Request) {
  return NextResponse.json({ message: 'Subscription successful' })
  // const subscription = await request.json()
  // const novu = new Novu(process.env.NOVU_API_KEY!)

  // try {
  //   // Associate the push subscription with the user in Novu
  //   // Note: You'll need to implement user authentication and get the userId
  //   const userId = 'user-id-here'
  //   await novu.subscribers.setCredentials(userId, 'webpush', subscription)
  //   return NextResponse.json({ message: 'Subscription successful' })
  // } catch (error) {
  //   console.error('Error saving subscription:', error)
  //   return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
  // }
}