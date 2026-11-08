import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Components never hold a raw colour: they use the --lp-* variables from
// tokens.css. Only the single source (tokens.ts) and its generated CSS may.
const srcDir = path.resolve(import.meta.dirname, '..')
const toRel = (file: string) => path.relative(srcDir, file).split(path.sep).join('/')

const allowed = new Set([
  'design/tokens.ts',
  'design/tokens.css',
  'design/no-raw-colours.test.ts',
  // Holds the expected colour values on purpose: it is the test of the design source.
  'design/tokens.test.ts',
  // Google's sign-in button: white, grey and the four-colour G are Google's brand, not ours (Decisions 2026-11-06).
  'components/landing/GoogleSignInButton.tsx',
])

// A hex colour is not preceded by a word character or "&" (HTML entities) and is not followed by
// a word character or "-" (so ids such as #bad-id or #root are not colours).
const rawColour = /(?<![\w&])#[0-9a-fA-F]{3,8}(?![\w-])|\brgba?\(|\bhsla?\(|\boklch\(/g

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.(ts|tsx|css)$/.test(entry.name) ? [full] : []
  })
}

describe('no raw colours outside the design tokens', () => {
  it('finds the source files to scan', () => {
    expect(walk(srcDir).length).toBeGreaterThan(3)
  })

  it('the pattern catches colours and ignores selectors and ids', () => {
    const matches = (text: string) => text.match(rawColour) ?? []
    expect(matches('color: #fff;')).toEqual(['#fff'])
    expect(matches("fill: '#0A1220'")).toEqual(['#0A1220'])
    expect(matches('background: #0A122080')).toEqual(['#0A122080'])
    expect(matches('a: rgba(1, 2, 3, 0.5); b: oklch(1 0 0); c: hsl(0 0% 0%)')).toHaveLength(3)
    expect(matches('#root { margin: 0 }')).toEqual([])
    expect(matches('#bad-id, #face-icon, &#123; and /page#add')).toEqual([])
  })

  it('has no #hex, rgb(), rgba(), hsl(), hsla() or oklch() in src/', () => {
    const found: string[] = []
    for (const file of walk(srcDir)) {
      if (allowed.has(toRel(file))) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          for (const match of line.matchAll(rawColour)) {
            found.push(`${toRel(file)}:${index + 1}: ${match[0]}`)
          }
        })
    }
    expect(found, `raw colours found, use var(--lp-...) instead:\n${found.join('\n')}`).toEqual([])
  })
})
