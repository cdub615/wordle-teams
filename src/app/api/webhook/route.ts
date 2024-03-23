import { processWebhookEvent, storeWebhookEvent } from '@/app/me/actions'
import { webhookHasMeta } from '@/lib/typeguards'
import { WebhookEvent } from '@/lib/types'

export async function POST(request: Request) {
  if (!process.env.LEMONSQUEEZY_WEBHOOK_SECRET) {
    return new Response('Lemon Squeezy Webhook Secret not set in .env', {
      status: 500,
    })
  }
  if (!process.env.SUPABASE_WEBHOOK_SECRET) {
    return new Response('Supabase Webhook Secret not set in .env', {
      status: 500,
    })
  }

  const rawBody = await request.text()
  const { fromLemonSqueezy, fromSupabase } = validateSignature(request.headers.get('X-Signature') ?? '')
  if (!fromLemonSqueezy && !fromSupabase) {
    return new Response('Invalid signature', { status: 400 })
  }

  if (fromLemonSqueezy) {
    const data = JSON.parse(rawBody) as unknown

    // Type guard to check if the object has a 'meta' property.
    if (webhookHasMeta(data)) {
      const webhookEventId = await storeWebhookEvent(data.meta.event_name, data)
      if (!webhookEventId) {
        return new Response('Failed to store webhook event', { status: 500 })
      }

      return new Response('OK', { status: 200 })
    }

    return new Response('Data invalid', { status: 400 })
  }

  if (fromSupabase) {
    try {
      const webhookEvent = JSON.parse(rawBody) as WebhookEvent
      await processWebhookEvent(webhookEvent)
      return new Response('OK', { status: 200 })
    } catch (error) {
      log.error(error)
      return new Response('Failed to process webhook event', { status: 500 })
    }
  }
}

const validateSignature = (signature: string) => {
  const lemonSqueezySecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET
  const supabaseSecret = process.env.SUPABASE_WEBHOOK_SECRET

  const fromLemonSqueezy = signature === lemonSqueezySecret
  const fromSupabase = signature === supabaseSecret

  return { fromLemonSqueezy, fromSupabase }
}
