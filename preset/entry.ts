// import "#internal/nitro/virtual/polyfill"
import {
  Request as CFRequest,
  Response as CFResponse,
  EventContext,
  KVNamespace,
  caches,
} from "@cloudflare/workers-types"
import type { NitroRouteRules } from "nitropack"
import { useNitroApp } from "nitropack/dist/runtime/app"
import { getRouteRulesForPath } from "nitropack/dist/runtime/route-rules"

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

  // Declare bindings herea
  PAGES_CACHE_KV: KVNamespace
  [key: string]: any
}

export type GeneratedPageMetadata = {
  /**
   * Creation time in seconds since epoch
   */
  ctime: number
}

function getIsrCacheKey(request: CFRequest, env: CFPagesEnv) {
  return request.url
}

export async function getIsrPage(request: CFRequest, env: CFPagesEnv) {
  const cacheKey = getIsrCacheKey(request, env)
  return env.PAGES_CACHE_KV.getWithMetadata<GeneratedPageMetadata>(cacheKey)
}

/**
 * Narrow down the type of route rules to include `isr` property
 */
export function isIsrRoute(
  routeRules: NitroRouteRules
): routeRules is Omit<NitroRouteRules, "isr"> & { isr: number | true } {
  return typeof routeRules.isr === "number" || routeRules.isr === true
}

export function storeIsrPage(
  request: CFRequest,
  env: CFPagesEnv,
  routeRules: Omit<NitroRouteRules, "isr"> & { isr: number | true },
  response: Response
) {
  const cacheKey = getIsrCacheKey(request, env)
  return env.PAGES_CACHE_KV.put(cacheKey, response.body as any, {
    // Expiration TTL must be at least 60 seconds
    expirationTtl: 60 * 60 * 24 * 30, // 30 days
    metadata: {
      ctime: Date.now() / 1000,
    } satisfies GeneratedPageMetadata,
  })
}

function getCacheControlHeader(routeRules: NitroRouteRules) {
  const edgeTTL = typeof routeRules.isr === "number" ? routeRules.isr : 60 * 60 * 24 * 30 // 30 days
  return `public, s-maxage=${edgeTTL}, stale-while-revalidate`
}

// @ts-expect-error - Rollup Virtual Modules
import { requestHasBody } from "#internal/nitro/utils"
declare function requestHasBody(request: globalThis.Request): boolean
// @ts-expect-error - Rollup Virtual Modules
import { isPublicAssetURL } from "#internal/nitro/virtual/public-assets"
declare function isPublicAssetURL(id: string): boolean

const nitroApp = useNitroApp()

// Adapted from cloudflare-pages
// https://github.com/unjs/nitro/blob/1aec53e14ab953e265bb7496a5af2408d809d553/src/runtime/entries/cloudflare-pages.ts
export default {
  async fetch(request: CFRequest, env: CFPagesEnv, context: EventContext<CFPagesEnv, string, any>) {
    const url = new URL(request.url)
    if (isPublicAssetURL(url.pathname)) {
      return env.ASSETS.fetch(request)
    }

    let body
    if (requestHasBody(request as unknown as Request)) {
      body = Buffer.from(await request.arrayBuffer())
    }

    // Expose latest env to the global context
    globalThis.__env__ = env

    const routeRules = getRouteRulesForPath(url.pathname)
    const cacheControl = getCacheControlHeader(routeRules)

    let res: Response | undefined
    if (isIsrRoute(routeRules)) {
      const cache = caches.default

      const pathKey = url.pathname.replace(/^\/+/, "") // remove prepended /
      // TODO investigate ideal key behavior
      const cacheKey = new CFRequest(`${url.origin}/${pathKey}` + url.search, request)
      res = (await cache.match(cacheKey)) as Response | undefined
      if (res) {
        console.log("CDN Cache HIT", cacheKey.url, [...res.headers.entries()])
        res = new Response(res.body, res)
        res.headers.set("x-cdn-cache", "HIT")
        return res
      }

      const page = await getIsrPage(request, env)
      if (page.value && page.metadata) {
        const age = Math.ceil(Date.now() / 1000 - page.metadata.ctime)

        // Stale page
        if (typeof routeRules.isr === "number" && age >= routeRules.isr) {
          const revalidate = (async () => {
            const res = await nitroApp.localFetch(url.pathname + url.search, {
              context: {
                cf: request.cf,
                waitUntil: (promise) => context.waitUntil(promise),
                cloudflare: {
                  request,
                  env,
                  context,
                },
              },
              host: url.hostname,
              protocol: url.protocol,
              method: request.method,
              headers: request.headers as unknown as Headers,
              body,
            })
            // determine Cloudflare cache behavior
            const cacheRes = res.clone()
            cacheRes.headers.set("cache-control", cacheControl)
            cacheRes.headers.set("x-nitro-isr", "HIT")
            await Promise.all([
              cache.put(cacheKey, cacheRes as unknown as CFResponse),
              storeIsrPage(request, env, routeRules, res.clone()),
            ])
          })()
          // Revalidate in the background
          context.waitUntil(revalidate)

          return new Response(page.value, {
            headers: {
              "content-type": "text/html",
              "cache-control": cacheControl,
              age: age.toString(),
              "x-nitro-isr": "REVALIDATE",
            },
          })
        }

        return new Response(page.value, {
          headers: {
            "content-type": "text/html",
            "cache-control": cacheControl,
            age: age.toString(),
            "x-nitro-isr": "HIT",
          },
        })
      }
    }

    res = await nitroApp.localFetch(url.pathname + url.search, {
      context: {
        cf: request.cf,
        waitUntil: (promise) => context.waitUntil(promise),
        cloudflare: {
          request,
          env,
          context,
        },
      },
      host: url.hostname,
      protocol: url.protocol,
      method: request.method,
      headers: request.headers as unknown as Headers,
      body,
    })

    if (isIsrRoute(routeRules)) {
      // https://github.com/cloudflare/kv-asset-handler/blob/main/src/index.ts#L242
      // Errored response
      if (res.status > 300 && res.status < 400) {
        if (res.body && "cancel" in Object.getPrototypeOf(res.body)) {
          // Body exists and environment supports readable streams
          res.body.cancel()
        } else {
          // Environment doesnt support readable streams, or null repsonse body. Nothing to do
        }
        res = new Response(null, res)
      } else {
        let opts = {
          headers: new Headers(res.headers),
          status: 0,
          statusText: "",
        }

        opts.headers.set("age", "0")
        opts.headers.set("cache-control", cacheControl)
        opts.headers.set("x-nitro-isr", "MISS")

        if (res.status) {
          opts.status = res.status
          opts.statusText = res.statusText
        } else if (opts.headers.has("Content-Range")) {
          opts.status = 206
          opts.statusText = "Partial Content"
        } else {
          opts.status = 200
          opts.statusText = "OK"
        }
        res = new Response(res.body, opts)
        res.headers.set("cache-control", cacheControl)
        context.waitUntil(storeIsrPage(request, env, routeRules, res.clone()))
        context.waitUntil(storeIsrPage(request, env, routeRules, res.clone()))
      }
    }
    return res
  },
}
