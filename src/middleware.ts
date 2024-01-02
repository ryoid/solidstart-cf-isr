import { EventContext as CFEventContext, Request as CFRequest, KVNamespace } from "@cloudflare/workers-types"
import { FetchEvent, MIMES, createMiddleware, readBody, send } from "@solidjs/start/server"
import type { NitroRouteRules } from "nitropack"
/**
 * Reference: https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#parameters
 * From Nitro: https://github.com/unjs/nitro/blob/1aec53e14ab953e265bb7496a5af2408d809d553/src/runtime/entries/cloudflare-pages.ts#L14
 */
interface CFPagesEnv {
  ASSETS: { fetch: (request: CFRequest) => Promise<Response> }
  CF_PAGES: "1"
  CF_PAGES_BRANCH: string
  CF_PAGES_COMMIT_SHA: string
  CF_PAGES_URL: string
  // Declare bindings here
  GENERATED_PAGES: KVNamespace
}

// extend event context
declare module "@solidjs/start/server" {
  interface H3EventContext {
    _nitro: {
      routeRules: NitroRouteRules
    }
    cloudflare: {
      request: CFRequest
      env: CFPagesEnv
      context: CFEventContext<CFPagesEnv, string, any>
    }
  }
}

function getIsrCacheKey(event: FetchEvent) {
  // deployment + path + string
  return event.context.cloudflare.env.CF_PAGES_URL + event.context.cloudflare.request.url
}

async function getIsrPage(event: FetchEvent) {
  // Assume ISR defined
  // const ttl = typeof event.context._nitro.routeRules.isr === "number" ? event.context._nitro.routeRules.isr : false

  // deployment + path + string
  const cacheKey = getIsrCacheKey(event)
  let page = await event.context.cloudflare.env.GENERATED_PAGES.getWithMetadata(cacheKey)
  console.log("got", cacheKey, page)
  if (!page?.value) {
    return
  }
  console.log("Cache hit", cacheKey, page.cacheStatus)
  return page
}

async function storeIsrPage(event: FetchEvent, response: Response) {
  if (!response.body) return
  // Assume ISR defined
  const ttl = typeof event.context._nitro.routeRules.isr === "number" ? event.context._nitro.routeRules.isr : false

  const cacheKey = getIsrCacheKey(event)

  const promise = event.context.cloudflare.env.GENERATED_PAGES.put(cacheKey, response.body as any, {
    expiration: ttl === false ? undefined : ttl,
    expirationTtl: ttl === false ? undefined : ttl,
  })
  event.context.cloudflare.context.waitUntil(promise)
}

export default createMiddleware({
  onRequest: [
    async (event) => {
      // wait until, event.context.cloudflare.context.waitUntil
      console.log("event.context", event.context)

      // isr/swr
      // Adapted from netlify adapter
      // https://github.com/unjs/nitro/blob/1aec53e14ab953e265bb7496a5af2408d809d553/src/runtime/entries/netlify.ts#L15
      if (event.context._nitro.routeRules.isr && event.context.cloudflare?.env.GENERATED_PAGES) {
        // const getIsrPage = await import("@netlify/functions").then((r) => r.getIsrPage || r.default.getIsrPage)
        const page = await getIsrPage(event)
        if (page) {
          // event.node.res.statusCode = res.status
          // event.node.res.setHeader(key, value)
          console.log("ISR Cache hit", page)
          return send(event, page.value, MIMES.html)
        }
      }
    },
    // (event) => {
    //   appendCorsHeaders(event, {})
    // },
  ],
  onBeforeResponse: [
    async (event, response) => {
      // isr/swr
      if (event.context._nitro.routeRules.isr) {
        console.log("[Response] Storing ISR res", event.context)
        if (event.context.cloudflare?.env.GENERATED_PAGES) {
          // storeIsrPage(event, body)
        }
      }
    },
  ],
})
