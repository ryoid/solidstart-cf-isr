import { getRequestEvent } from "solid-js/web"

const buildEnv = process.env

export function GET() {
  const metaEnv = Object.fromEntries(Object.entries(import.meta.env).filter((e) => typeof e[1] !== "object"))
  const event = getRequestEvent()!
  console.log('event', Object.keys(event))
  return {
    "build-env": metaEnv,
    "process-env": process.env,
    // getRequestEvent: event.context.cloudflare?.env,
    buildEnv,
  }
}
