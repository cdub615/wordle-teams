'use server'

import { NewCheckout, createCheckout, getCustomer, lemonSqueezySetup, listProducts } from '@lemonsqueezy/lemonsqueezy.js'
import { log } from 'next-axiom'

const testMode = process.env.ENVIRONMENT !== 'prod'
const storeId = process.env.LEMONSQUEEZY_STORE_ID!
const url =
  process.env.ENVIRONMENT === 'prod'
    ? 'https://wordleteams.com'
    : process.env.ENVIRONMENT === 'dev'
    ? 'https://dev.wordleteams.com'
    : 'http://localhost:3000'
const redirectUrl = `${url}/me`

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
  if (!variantId) return undefined
  const newCheckout: NewCheckout = {
    productOptions: {
      redirectUrl,
      receiptButtonText: 'Go to Dashboard',
      receiptThankYouNote: 'Thank you for purchasing Wordle Teams!',
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
  const { error, data } = await createCheckout(storeId, variantId, newCheckout)
  if (error) log.error(error.message)
  return data ?? undefined
}

export const getCustomerPortalUrl = async (customerId: number) => {
  log.info(`getting customer portal url for customer ${customerId}`)
  configureLemonSqueezy()
  const { error, data } = await getCustomer(customerId)
  log.info(`received`, { data: data?.data.attributes.urls?.customer_portal })
  if (error) log.error(error.message)
  return data?.data.attributes.urls?.customer_portal ?? undefined
}
