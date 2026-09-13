import { defineComponent } from 'convex/server'

/**
 * THE NAME IS LOAD-BEARING AND MUST STAY "betterAuth".
 *
 * Convex identifies a mounted component by its mount name, which `use()`
 * resolves as `options.name ?? definition.defaultName ?? basename(path)`
 * (node_modules/convex/dist/esm/server/components/index.js:77-86 — the
 * `basename(path)` fallback is the `.split("/").pop()` on 86, which is why the
 * range has to reach past the `name` assignment on 84). The prebuilt component
 * this replaces is also `defineComponent("betterAuth")`, which is the whole
 * reason the existing user, session and account rows survive the move and
 * `components.betterAuth` still resolves at every call site.
 *
 * Renaming it orphans every row in the component.
 */
const component = defineComponent('betterAuth')

export default component
