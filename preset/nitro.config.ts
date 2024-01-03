import type { NitroPreset } from "nitropack"
import { fileURLToPath } from "node:url"

export default <NitroPreset>{
  // https://github.com/unjs/nitro/blob/1aec53e14ab953e265bb7496a5af2408d809d553/src/presets/cloudflare-pages.ts#L14
  // Extend existing presets
  extends: "cloudflare-pages",
  entry: fileURLToPath(new URL("./entry.ts", import.meta.url)),
}
