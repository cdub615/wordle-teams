import { processWebhookEvent, storeWebhookEvent } from '@/app/me/actions'
import { webhookHasMeta } from '@/lib/typeguards'
import { WebhookEvent } from '@/lib/types'
import { log } from 'next-axiom'
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
    log.info('from lemon squeezy')
    const data = JSON.parse(rawBody) as unknown

    // Type guard to check if the object has a 'meta' property.
    if (webhookHasMeta(data)) {
      log.info('trying to store webhook event')
      const webhookEvent: WebhookEvent = {
        playerId: data.meta.custom_data.user_id,
        eventName: data.meta.event_name,
        webhookId: data.meta.webhook_id,
        body: data,
      }

      log.info('webhookEvent', {
        playerId: webhookEvent.playerId,
        eventName: webhookEvent.eventName,
        webhookId: webhookEvent.webhookId,
      })
      const webhookEventId = await storeWebhookEvent(webhookEvent)
      if (!webhookEventId) {
        return new Response('Failed to store webhook event', { status: 500 })
      }
      const { success } = await processWebhookEvent(webhookEvent.webhookId)
      if (!success) {
        return new Response('Failed to process webhook event', { status: 500 })
      }

      return new Response('OK', { status: 200 })
    }

    return new Response('Data invalid', { status: 400 })
  }
}

const validSignature = (signature: string, rawBody: string) => {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET!

  log.info('signature', { signature })

  const hmac = crypto.createHmac('sha256', secret)
  const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8')
  const signatureBuffer = Buffer.from(signature, 'utf8')

  log.info(`digest byte length: ${digest.byteLength}, signature byte length: ${signatureBuffer.byteLength}`)

  // if (!crypto.timingSafeEqual(digest, signatureBuffer)) return false

  return signature === secret
}
