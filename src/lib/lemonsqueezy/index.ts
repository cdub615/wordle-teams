'use server'

import {
  NewCheckout,
  NewCustomer,
  createCheckout,
  createCustomer,
  lemonSqueezySetup,
  listProducts,
} from '@lemonsqueezy/lemonsqueezy.js'
import { log } from 'next-axiom'

const testMode = process.env.ENVIRONMENT !== 'prod'

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
  const { error, data } = await listProducts({
    filter: { storeId: process.env.LEMONSQUEEZY_STORE_ID! },
    include: ['variants'],
  })
  if (error) log.error(error.message)
  const pro = data?.data.find((p) => p.attributes.name === 'Free')
  if (pro && pro.relationships?.variants?.data) return Number.parseInt(pro.relationships?.variants?.data[0]?.id)
}

const getProVariantId = async () => {
  configureLemonSqueezy()
  const { error, data } = await listProducts({
    filter: { storeId: process.env.LEMONSQUEEZY_STORE_ID! },
    include: ['variants'],
  })
  if (error) log.error(error.message)
  const pro = data?.data.find((p) => p.attributes.name === 'Pro')
  if (pro && pro.relationships?.variants?.data) return pro.relationships?.variants?.data[0]?.id
}

export const createNewCustomer = async (name: string, email: string) => {
  configureLemonSqueezy()
  const newCustomer: NewCustomer = { name, email }
  const { error, data } = await createCustomer(process.env.LEMONSQUEEZY_STORE_ID!, newCustomer)
  if (error) log.error(error.message)
  return data ?? undefined
}

export const createNewCheckout = async (name: string, email: string, userId: string) => {
  configureLemonSqueezy()
  const variantId = await getProVariantId()
  if (!variantId) return undefined
  const newCheckout: NewCheckout = {
    productOptions: {
      redirectUrl: `${process.env.NEXT_PUBLIC_VERCEL_URL}/me`,
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
  const { error, data } = await createCheckout(process.env.LEMONSQUEEZY_STORE_ID!, variantId, newCheckout)
  if (error) log.error(error.message)
  return data ?? undefined
}
