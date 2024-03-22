'use server'

import { NewCheckout, createCheckout, lemonSqueezySetup, listProducts } from '@lemonsqueezy/lemonsqueezy.js'
import { log } from 'next-axiom'

const testMode = process.env.ENVIRONMENT !== 'prod'
const storeId = process.env.LEMONSQUEEZY_STORE_ID!
const redirectUrl = `${process.env.NEXT_PUBLIC_VERCEL_URL}/me`

function configureLemonSqueezy() {
  const requiredVars = ['LEMONSQUEEZY_API_KEY', 'LEMONSQUEEZY_STORE_ID', 'LEMONSQUEEZY_WEBHOOK_SECRET']

  const missingVars = requiredVars.filter((varName) => !process.env[varName])

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required LEMONSQUEEZY env variables: ${missingVars.join(', ')}. Please, set them in your .env file.`
    )
  }

  lemonSqueezySetup({
    apiKey: process.env.LEMONSQUEEZY_API_KEY,
    onError: (error) => {
      log.error(error.message, error)
    },
  })
}

export const getFreeVariantId = async () => {
  configureLemonSqueezy()
  const { error, data } = await listProducts({ filter: { storeId }, include: ['variants'] })
  if (error) log.error(error.message)
  const pro = data?.data.find((p) => p.attributes.name === 'Free')
  if (pro && pro.relationships?.variants?.data) return Number.parseInt(pro.relationships?.variants?.data[0]?.id)
}

const getProVariantId = async () => {
  const { error, data } = await listProducts({ filter: { storeId }, include: ['variants'] })
  if (error) log.error(error.message)
  const pro = data?.data.find((p) => p.attributes.name === 'Pro')
  if (pro && pro.relationships?.variants?.data) return pro.relationships?.variants?.data[0]?.id
}

export const createNewCheckout = async (name: string, email: string, userId: string) => {
  configureLemonSqueezy()
  const variantId = await getProVariantId()
  log.info(`storeId: ${storeId}`)
  log.info(`pro variantId: ${variantId}`)
  log.info(`redirectUrl: ${redirectUrl}`)
  log.info(`testMode: ${testMode}`)
  log.info(`name: ${name}`)
  log.info(`email: ${email}`)
  log.info(`userId: ${userId}`)
  if (!variantId) return undefined
  const newCheckout: NewCheckout = {
    productOptions: {
      redirectUrl,
      receiptButtonText: 'Go to Dashboard',
      receiptThankYouNote: 'Thank you for signing up Wordle Teams!',
    },
    checkoutOptions: {
      dark: true,
      embed: true,
    },
    checkoutData: {
      email,
      name,
      custom: {
        user_id: userId,
      },
    },
    testMode,
  }
  log.info('newCheckout', newCheckout)
  const { error, data } = await createCheckout(storeId, variantId, newCheckout)
  if (error) log.error(error.message)
  return data ?? undefined
}
