import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

test('get returns null before any set', async () => {
  const t = convexTest(schema, modules)
  expect(await t.query(api.status.get, {})).toBeNull()
})

test('set then get round-trips the message', async () => {
  const t = convexTest(schema, modules)
  await t.mutation(api.status.set, { message: 'hello from convex' })
  expect(await t.query(api.status.get, {})).toBe('hello from convex')
})

test('set overwrites the existing message instead of accumulating docs', async () => {
  const t = convexTest(schema, modules)
  await t.mutation(api.status.set, { message: 'first' })
  await t.mutation(api.status.set, { message: 'second' })
  expect(await t.query(api.status.get, {})).toBe('second')
  await t.run(async (ctx) => {
    const all = await ctx.db.query('statusMessages').collect()
    expect(all).toHaveLength(1)
  })
})
