import {
  NewCheckout,
  createCheckout,
  getAuthenticatedUser,
  listCustomers,
  listProducts,
  listStores,
} from '@lemonsqueezy/lemonsqueezy.js'

export const lemonsqueezyUser = async () => {
  const { error, data, statusCode } = await getAuthenticatedUser()
  if (error) console.error(error)
  console.log(`fetched authenticated user from lemonsqueezy, status code: ${statusCode}`)
  console.dir(data)
}

export const products = async () => {
  const { error, data, statusCode } = await listProducts()
  if (error) console.error(error)
  console.log(`fetched products from lemonsqueezy, status code: ${statusCode}`)
  console.dir(data?.data)
}

export const stores = async () => {
  const { error, data, statusCode } = await listStores()
  if (error) console.error(error)
  // console.log(`fetched stores from lemonsqueezy, status code: ${statusCode}`)
  // console.dir(data?.data.find((s) => s.attributes.slug === 'wordleteams')?.id)
  const storeId = Number.parseInt(data?.data.find((s) => s.attributes.slug === 'wordleteams')?.id ?? '')
  // const newCustomer: NewCustomer = { name: 'test', email: 'test@example.com' }
  const { error: newCustomersError, data: customers } = await listCustomers({ filter: { storeId } })
  console.log(customers?.data.find((c) => c.attributes.email === 'test@example.com')?.attributes.urls)
}

export const checkout = async () => {
  const storeId = 75252
  const variantId = 289888
  const newCheckout: NewCheckout = {
    productOptions: {
      name: 'New Checkout Test',
      description: 'a new checkout test',
    },
    checkoutOptions: {
      embed: true,
      media: true,
      logo: true,
    },
    checkoutData: {
      email: 'test@example.com',
      name: 'Lemon Squeezy Test',
    },
    expiresAt: null,
    preview: true,
    testMode: true,
  }
  const { statusCode, error, data } = await createCheckout(storeId, variantId, newCheckout)
  console.log(data?.data)
}
