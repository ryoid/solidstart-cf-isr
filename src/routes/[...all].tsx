// src/routes/[...all].tsx
import { useParams } from "@solidjs/router"
import { createEffect, createResource, createSignal, onMount } from "solid-js"

export default function CatchAll() {
  const params = useParams()
  const [generatedAt] = createResource(() => new Date(), {
    ssrLoadFrom: "initial",
    initialValue: new Date(),
  })
  const [timeAgo, setTimeAgo] = createSignal<string>("...")

  createEffect(() => {
    const delta = Date.now() - generatedAt().getTime()
    const seconds = Math.round(delta / 1000)
    const ms = Math.round(delta % 1000)
    setTimeAgo(`${seconds}.${ms} seconds ago`)
  })

  return (
    <main>
      <h1>Hello World</h1>
      <div>
        Path <code>/{params.all}</code>
      </div>
      <div>Generated at {generatedAt().toISOString()}</div>
      <div>{timeAgo()}</div>
    </main>
  )
}
