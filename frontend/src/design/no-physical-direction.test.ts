import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// The app is ready for right-to-left languages (UX Spec 1.9), so components use logical direction classes:
// ps-/pe-/ms-/me-/start-/end-/text-start/text-end/border-s/border-e/rounded-s/rounded-e, never the physical ones.
// Icons that point (a back arrow) flip with rtl:rotate-180.
const srcDir = path.resolve(import.meta.dirname, '..')
const toRel = (file: string) => path.relative(srcDir, file).split(path.sep).join('/')

// A class starts after whitespace, a quote, a backtick, a colon (variants such as sm:) or a bracket, and may be negative.
// Names inside longer words (copyright-, text-leftover) do not match: the character before must not be a word
// character or a hyphen. left- and right- count only when a Tailwind inset value follows (left-0, right-1/2, left-auto,
// left-[10px]), so prose such as "right-to-left" in a comment or a test title is left alone.
const physicalDirection = new RegExp(
  [
    String.raw`(?<![\w-])-?(?:pl|pr|ml|mr)-`,
    String.raw`(?<![\w-])-?(?:left|right)-(?:\d|\[|\(|(?:auto|px|full)(?![\w-]))`,
    String.raw`(?<![\w-])text-(?:left|right)(?![\w-])`,
    String.raw`(?<![\w-])(?:rounded|border)-(?:l|r|tl|tr|bl|br)(?:-|(?![\w-]))`,
  ].join('|'),
  'g',
)

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.tsx') ? [full] : []
  })
}

describe('logical direction classes only', () => {
  it('finds the source files to scan', () => {
    expect(walk(srcDir).length).toBeGreaterThan(3)
  })

  it('the pattern catches physical classes, also with variants and a minus sign', () => {
    const matches = (text: string) => text.match(physicalDirection) ?? []
    expect(matches('className="pl-2 pr-4 ml-1 mr-auto"')).toEqual(['pl-', 'pr-', 'ml-', 'mr-'])
    expect(matches('className="left-0 right-2 -left-1 sm:right-1/2 hover:pl-1"')).toEqual([
      'left-0',
      'right-2',
      '-left-1',
      'right-1',
      'pl-',
    ])
    expect(matches('className="left-auto right-px left-full right-[10px] left-(--x)"')).toEqual([
      'left-auto',
      'right-px',
      'left-full',
      'right-[',
      'left-(',
    ])
    expect(matches('className="text-left text-right"')).toEqual(['text-left', 'text-right'])
    expect(matches('className="rounded-l-lg rounded-r rounded-tl-md border-l-2 border-r"')).toEqual([
      'rounded-l-',
      'rounded-r',
      'rounded-tl-',
      'border-l-',
      'border-r',
    ])
    expect(matches('className={cn(`pl-2`, "x")}')).toEqual(['pl-'])
  })

  it('the pattern leaves logical classes and other words alone', () => {
    const matches = (text: string) => text.match(physicalDirection) ?? []
    expect(
      matches(
        'className="ps-2 pe-4 ms-1 me-auto start-0 end-2 text-start text-end rounded-s-lg rounded-e border-s-2 border-e rtl:rotate-180"',
      ),
    ).toEqual([])
    expect(matches('copyright-notice, text-leftover, group-data-horizontal/toggle-group:first:rounded-s-lg')).toEqual([])
    expect(matches('a right-to-left page, a left-aligned label, the right-hand side')).toEqual([])
    expect(matches('translate-x-0 -translate-x-[calc(100%-2px)] after:-inset-x-3 inset-x-0 min-w-0')).toEqual([])
    expect(matches('border-border border-b border-t rounded-t-lg rounded-b-lg')).toEqual([])
  })

  it('has no physical direction class in any component or page, generated ones included', () => {
    const found: string[] = []
    for (const file of walk(srcDir)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          for (const match of line.matchAll(physicalDirection)) {
            found.push(`${toRel(file)}:${index + 1}: ${match[0]}`)
          }
        })
    }
    expect(found, `physical direction classes found, use the logical ones instead:\n${found.join('\n')}`).toEqual([])
  })
})
