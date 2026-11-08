import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Palette A1: in the light theme `primary` is a pastel fill. As text, an icon, a line or an accent it is too pale on
// a light surface, so those uses take `primaryStrong` (text-primary-strong, border-primary-strong, accent-primary-strong).
// This scan keeps a new `text-primary` from slipping back in. `bg-primary` as a fill with a dark label is fine.
const srcDir = path.resolve(import.meta.dirname, '..')
const toRel = (file: string) => path.relative(srcDir, file).split(path.sep).join('/')

// Pages that stay dark by decision (Landing, Terms), where primary and primaryStrong are the same colour. The play
// triangle of the Practice button is also allowed: it is drawn on a dark disc (bg-on-primary), not on a light surface.
const darkSurfaces = new Set(['pages/LandingPage.tsx', 'pages/TermsPage.tsx'])
const onDarkDisc = /fill-current text-primary(?![\w-])/

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const pale = /(?<![\w-])(text|border|accent|ring|stroke|fill|outline)-primary(?![\w-])/g

describe('primary used as text, an icon or a line', () => {
  it('the pattern finds pale primary and ignores the strong one, the label colour and the fill', () => {
    const matches = (text: string) => text.match(pale) ?? []
    expect(matches('text-primary hover:border-primary/60 accent-primary')).toEqual(['text-primary', 'border-primary', 'accent-primary'])
    expect(matches('text-primary-strong border-primary-strong text-primary-foreground bg-primary text-on-primary')).toEqual([])
  })

  it('is always the strong role outside the dark surfaces', () => {
    const found: string[] = []
    for (const file of walk(srcDir)) {
      if (darkSurfaces.has(toRel(file)) || toRel(file).startsWith('design/')) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (onDarkDisc.test(line)) return
          for (const match of line.matchAll(pale)) found.push(`${toRel(file)}:${index + 1}: ${match[0]}`)
        })
    }
    expect(found, `use the -strong role for text, icons and lines:\n${found.join('\n')}`).toEqual([])
  })

  it('no label reads the page background: coloured buttons use their own on-colour role (text-on-primary, text-on-edit, text-on-share)', () => {
    const found: string[] = []
    for (const file of walk(srcDir)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/(?<![\w-])text-background(?![\w-])/.test(line)) found.push(`${toRel(file)}:${index + 1}`)
        })
    }
    expect(found).toEqual([])
  })
})
