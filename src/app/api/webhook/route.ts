import { processWebhookEvent, storeWebhookEvent } from '@/app/me/actions'
import { createClient } from '@/lib/supabase/actions'
import { webhookHasMeta } from '@/lib/typeguards'
import { WebhookEvent } from '@/lib/types'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import crypto from 'node:crypto'

export async function POST(request: Request) {
  if (!process.env.LEMONSQUEEZY_WEBHOOK_SECRET) {
    return new Response('Lemon Squeezy Webhook Secret not set in .env', {
      status: 500,
    })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('X-Signature') ?? ''

  if (!validSignature(signature, rawBody)) return new Response('Invalid signature', { status: 400 })
  else {
    const data = JSON.parse(rawBody) as unknown

    // Type guard to check if the object has a 'meta' property.
    if (webhookHasMeta(data)) {
      const webhookEvent: WebhookEvent = {
        playerId: data.meta.custom_data.user_id,
        eventName: data.meta.event_name,
        webhookId: data.meta.webhook_id,
        body: data,
      }
      const webhookEventId = await storeWebhookEvent(webhookEvent)
      if (!webhookEventId) {
        return new Response('Failed to store webhook event', { status: 500 })
      }
      const { success } = await processWebhookEvent(webhookEvent.webhookId)
      if (!success) {
        return new Response('Failed to process webhook event', { status: 500 })
      }

      const supabase = createClient(cookies())
      const { data } = await supabase.auth.getSession()
      const refreshToken = data.session?.refresh_token
      log.info('refreshing session with current session', { refreshToken })

      const { error: refreshError } = await supabase.auth.refreshSession({ refresh_token: refreshToken ?? '' })

      if (refreshError) {
        log.error('Failed to refresh session', { error: refreshError?.message })
      }
      return new Response('OK', { status: 200 })
    }

    return new Response('Data invalid', { status: 400 })
  }
}

const validSignature = (signature: string, rawBody: string): boolean => {
  try {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET!

    const hmac = crypto.createHmac('sha256', secret)
    const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8')
    const signatureBuffer = Buffer.from(signature, 'utf8')

    return crypto.timingSafeEqual(digest, signatureBuffer)
  } catch (error: any) {
    log.error('Failed to validate webhook signature', { error: error.message })
    return false
  }
}
