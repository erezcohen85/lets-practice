// Renders src/design/tokens.ts into src/design/tokens.css and src/design/DESIGN.md.
// Run with `npm run tokens` (Node's built-in TypeScript support, no extra dependency).
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { renderCss, renderDesignMd } from '../src/design/render.ts'
import { tokens } from '../src/design/tokens.ts'

const designDir = path.resolve(import.meta.dirname, '../src/design')

const outputs: [file: string, content: string][] = [
  ['tokens.css', renderCss(tokens)],
  ['DESIGN.md', renderDesignMd(tokens)],
]

for (const [file, content] of outputs) {
  writeFileSync(path.join(designDir, file), content)
  console.log(`wrote src/design/${file}`)
}
