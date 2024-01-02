import { defineConfig } from "@solidjs/start/config"

export default defineConfig({
  define: {
    "import.meta.env.CF_PAGES_URL": JSON.stringify(process.env.CF_PAGES_URL),
    "import.meta.env.VITE_DEPLOYMENT_ID": JSON.stringify(process.env.CF_PAGES_URL)?.match(/https?:\/\/(w{8})..+/)?.[0],
  },
  start: {
    // middleware: "./src/middleware.ts",
    server: {
      preset: "./preset",
      rollupConfig: {
        external: ["__STATIC_CONTENT_MANIFEST", "node:async_hooks"],
      },

      storage: {
        // storage name, use for Route Rule `cache.base`
        "page-cache": {
          driver: "cloudflare-kv-binding",
          binding: "GENERATED_PAGES",

          // driver: "cloudflare-kv-http",
          // driver config
          // https://unstorage.unjs.io/drivers/cloudflare-kv-http
          // accountId: process.env.PAGE_CACHE_ACCOUNT_ID,
          // namespaceId: process.env.PAGE_CACHE_NAMESPACE_ID,
          // apiToken: process.env.PAGE_CACHE_API_TOKEN,
        },
      },
      prerender: {
        // pages generated at build time and cached permanently
        routes: ["/", "/about", "/prerender"],
      },
      routeRules: {
        "/swr": {
          swr: true,
          cache: {
            base: "page-cache",
          },
        },
        "/swr/10": {
          swr: 10,
          cache: {
            base: "page-cache",
          },
        },
        "/swr/static": {
          static: true,
          cache: {
            base: "page-cache",
          },
        },

        // revalidated every 15 seconds, in the background
        "/isr/**": {
          isr: 15,
        },
        //always dynamically generated
        "/dynamic": {
          isr: false,
        },
        // generated on demand then cached permanently
        "/static": {
          isr: true,
        },
        // page generated at build time and cached permanently
        "/prerendered": {
          prerender: true,
        },
      },
    },
  },
})
