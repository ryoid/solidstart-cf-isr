const buildEnv = process.env

export function GET() {
  const metaEnv = Object.fromEntries(Object.entries(import.meta.env).filter((e) => typeof e[1] !== "object"))
  return {
    "build-env": metaEnv,
    "process-env": process.env,
    buildEnv,
  }
}
