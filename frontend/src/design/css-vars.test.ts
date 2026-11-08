import { readFileSync } from 'node:fs'
import path from 'node:path'

// index.css maps Tailwind and shadcn/ui onto the --lp-* variables. A misspelt
// variable name silently yields no colour, so every reference must be defined
// in the generated tokens.css, and index.css itself must hold no raw colour.
const designDir = import.meta.dirname
const indexCss = readFileSync(path.resolve(designDir, '..', 'index.css'), 'utf8')
const tokensCss = readFileSync(path.resolve(designDir, 'tokens.css'), 'utf8')

// Same pattern as no-raw-colours.test.ts.
const rawColour = /(?<![\w&])#[0-9a-fA-F]{3,8}(?![\w-])|\brgba?\(|\bhsla?\(|\boklch\(/g

const referenced = [...new Set([...indexCss.matchAll(/var\((--lp-[\w-]+)/g)].map((match) => match[1]))]
const defined = new Set([...tokensCss.matchAll(/^\s*(--lp-[\w-]+)\s*:/gm)].map((match) => match[1]))

describe('index.css and tokens.css', () => {
  it('index.css references token variables', () => {
    expect(referenced.length).toBeGreaterThan(30)
  })

  it('tokens.css defines variables', () => {
    expect(defined.size).toBeGreaterThan(60)
  })

  it('every var(--lp-...) used in index.css is defined in tokens.css', () => {
    const missing = referenced.filter((name) => !defined.has(name))
    expect(missing, `not defined in tokens.css: ${missing.join(', ')}`).toEqual([])
  })

  it('index.css maps no part colour (Decisions 2026-10-29)', () => {
    expect(indexCss).not.toMatch(/-part-/)
  })

  it('index.css holds no raw colour', () => {
    const found = indexCss
      .split('\n')
      .flatMap((line, index) => [...line.matchAll(rawColour)].map((match) => `index.css:${index + 1}: ${match[0]}`))
    expect(found, `raw colours found, use var(--lp-...) instead:\n${found.join('\n')}`).toEqual([])
  })
})
