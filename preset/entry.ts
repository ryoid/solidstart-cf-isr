// import "#internal/nitro/virtual/polyfill"
import type { Request as CFRequest, EventContext, KVNamespace } from "@cloudflare/workers-types"
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
  isr: number | boolean
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
      isr: routeRules.isr,
    } satisfies GeneratedPageMetadata,
  })
}

// @ts-expect-error - Rollup Virtual Modules
import { requestHasBody } from "#internal/nitro/utils"
declare function requestHasBody(request: Request): boolean
// @ts-expect-error - Rollup Virtual Modules
import { isPublicAssetURL } from "#internal/nitro/virtual/public-assets"
import { getAssetFromKV } from "@cloudflare/kv-asset-handler"
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

    if (isIsrRoute(routeRules)) {
      try {
        const res = await getAssetFromKV(
          {
            request: request as unknown as Request,
            waitUntil(promise) {
              return context.waitUntil(promise)
            },
          },
          {
            cacheControl: {
              edgeTTL: typeof routeRules.isr === "number" ? routeRules.isr : 60 * 60 * 24 * 30, // 30 days
            },
            ASSET_NAMESPACE: env.PAGES_CACHE_KV,
            // mapRequestToAsset: baseURLModifier,
          }
        )
        console.log("got re from asset kv", res)
        return res
      } catch {
        // Ignore
      }
      const page = await getIsrPage(request, env)
      if (page.value && page.metadata) {
        const age = Math.ceil(Date.now() / 1000 - page.metadata.ctime)

        // Stale page
        if (typeof page.metadata.isr === "number" && age >= page.metadata.isr) {
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
            storeIsrPage(request, env, routeRules, res.clone())
          })()
          // Revalidate in the background
          context.waitUntil(revalidate)

          return new Response(page.value, {
            headers: {
              "content-type": "text/html",
              age: age.toString(),
              "x-nitro-isr": "REVALIDATE",
            },
          })
        }

        return new Response(page.value, {
          headers: {
            "content-type": "text/html",
            age: age.toString(),
            "x-nitro-isr": "HIT",
          },
        })
      }
    }

    let res = await nitroApp.localFetch(url.pathname + url.search, {
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

    if (isIsrRoute(routeRules) && res.body !== null) {
      res = new Response(res.body, res)
      res.headers.set("age", "0")
      res.headers.set("x-nitro-isr", "MISS")

      context.waitUntil(storeIsrPage(request, env, routeRules, res.clone()))
    }
    return res
  },
}
