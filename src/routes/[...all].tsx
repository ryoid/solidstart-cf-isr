// src/routes/[...all].tsx
import { useParams } from "@solidjs/router"
import { createSignal, onMount } from "solid-js"

export default function CatchAll() {
  const params = useParams()

  const [timeAgo, setTimeAgo] = createSignal<string>("...")
  let ref: HTMLDivElement
  onMount(() => {
    const generatedAt = new Date(ref.textContent!)
    const delta = Date.now() - generatedAt.getTime()
    const seconds = Math.round(delta / 1000)
    const ms = Math.round(delta % 1000)
    setTimeAgo(`${seconds}.${ms} seconds ago`)
  })
  return (
    <main>
      <h1>
        Hello <code>/{params.all}</code>
      </h1>
      <div>
        Generated at <span ref={ref}>{new Date().toISOString()}</span>
      </div>
      <div>{timeAgo()}</div>
    </main>
  )
}
