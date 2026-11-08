import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderCss, renderDesignMd } from './render.ts'
import { tokens, waveColor } from './tokens.ts'
import type { ThemeName } from './tokens.ts'

const themes: ThemeName[] = ['dark', 'light']
const hex = /^#[0-9A-F]{6}$/i
const rgba = /^rgba\(\d+,\s*\d+,\s*\d+,\s*(0|1|0?\.\d+)\)$/
const isColour = (value: string) => hex.test(value) || rgba.test(value)

const committed = (file: string) =>
  readFileSync(path.resolve(import.meta.dirname, file), 'utf8')

describe('generated files do not drift from tokens.ts', () => {
  it('tokens.css equals renderCss(tokens)', () => {
    expect(
      renderCss(tokens),
      'tokens.css is out of date: run npm run tokens',
    ).toBe(committed('tokens.css'))
  })

  it('DESIGN.md equals renderDesignMd(tokens)', () => {
    expect(
      renderDesignMd(tokens),
      'DESIGN.md is out of date: run npm run tokens',
    ).toBe(committed('DESIGN.md'))
  })
})

describe('colour roles', () => {
  it('both themes have exactly the same colour keys', () => {
    expect(Object.keys(tokens.color.light).sort()).toEqual(
      Object.keys(tokens.color.dark).sort(),
    )
  })

  it('both themes have exactly the same flag chips, each with bg and text', () => {
    expect(Object.keys(tokens.flags.light).sort()).toEqual(
      Object.keys(tokens.flags.dark).sort(),
    )
    for (const theme of themes) {
      for (const chip of Object.values(tokens.flags[theme])) {
        expect(Object.keys(chip).sort()).toEqual(['bg', 'text'])
      }
    }
  })

  it('every colour value is a #rrggbb or an rgba(...)', () => {
    const values: string[] = [
      ...tokens.aurora,
      ...themes.flatMap((theme) => [tokens.wave.low[theme], tokens.wave.mid[theme], tokens.wave.high[theme]]),
      ...Object.values(tokens.cursorColours),
    ]
    for (const theme of themes) {
      values.push(...Object.values(tokens.color[theme]))
      for (const chip of Object.values(tokens.flags[theme])) {
        values.push(chip.bg, chip.text)
      }
    }
    const invalid = values.filter((value) => !isColour(value))
    expect(invalid).toEqual([])
  })

  it('dark values match the Midnight canvas', () => {
    const dark = tokens.color.dark
    expect(dark.background).toBe('#0A1220')
    expect(dark.primary).toBe('#5EEAD4')
    expect(dark.loop).toBe('#A78BFA')
    expect(dark.selected).toBe('#FBBF24')
    expect(dark.anchor).toBe('#34D399')
    expect(dark.problem).toBe('#FDA4AF')
    expect(dark.paper).toBe('#FAFAF7')
    expect(dark.paperCursor).toBe('#14B8A6')
  })

  it('has the solid danger and bright danger roles of the prototype, the same in both themes (Ruling R1)', () => {
    for (const theme of themes) {
      const colour = tokens.color[theme]
      expect(colour.danger).toBe('#E11D48')
      expect(colour.onDanger).toBe('#FFFFFF')
      expect(colour.dangerBright).toBe('#F43F5E')
    }
  })

  it('has the share pink of the prototype in dark and the softer one of palette A1 in light', () => {
    expect(tokens.color.dark.share).toBe('#F9A8D4')
    expect(tokens.color.light.share).toBe('#F7B4D6')
  })

  it('keeps the text-style problem colour pale in the dark theme', () => {
    expect(tokens.color.dark.problem).toBe('#FDA4AF')
  })

  it('paper roles are the same in both themes (the score stays white paper)', () => {
    for (const key of ['paper', 'ink', 'paperCursor', 'paperAnchor', 'paperSelected', 'paperMoved'] as const) {
      expect(tokens.color.light[key]).toBe(tokens.color.dark[key])
    }
  })
})

describe('waveColor', () => {
  it('picks low, mid or high by the thresholds', () => {
    expect(waveColor(0.2)).toBe(tokens.wave.low.dark)
    expect(waveColor(0.5)).toBe(tokens.wave.mid.dark)
    expect(waveColor(0.9)).toBe(tokens.wave.high.dark)
  })

  it('switches exactly at the thresholds', () => {
    expect(waveColor(tokens.wave.midFrom)).toBe(tokens.wave.mid.dark)
    expect(waveColor(tokens.wave.highFrom)).toBe(tokens.wave.high.dark)
  })

  it('takes the colours of the theme it is asked for', () => {
    expect(waveColor(0.2, 'light')).toBe('#2B9E90')
    expect(waveColor(0.5, 'light')).toBe('#8A6FE8')
    expect(waveColor(0.9, 'light')).toBe('#DB5F9F')
  })
})

describe('palette A1 (Soft aurora, with glow), light theme', () => {
  const dark = tokens.color.dark
  const light = tokens.color.light

  it('waveform: dark keeps the pastels, light has the deeper trio', () => {
    expect([tokens.wave.low.dark, tokens.wave.mid.dark, tokens.wave.high.dark]).toEqual(['#5EEAD4', '#A78BFA', '#F9A8D4'])
    expect([tokens.wave.low.light, tokens.wave.mid.light, tokens.wave.high.light]).toEqual(['#2B9E90', '#8A6FE8', '#DB5F9F'])
  })

  it('the three big buttons are pastel in light with a dark label: Practice, Edit map, Share', () => {
    expect([light.primary, light.edit, light.share]).toEqual(['#79E0D2', '#BDAAF7', '#F7B4D6'])
    expect([light.onPrimary, light.onEdit, light.onShare]).toEqual(['#0A1220', '#0A1220', '#0A1220'])
  })

  it('dark keeps its buttons exactly: the Edit map fill is the loop colour, the labels are the Midnight canvas', () => {
    expect(dark.primary).toBe('#5EEAD4')
    expect(dark.onPrimary).toBe('#05201C')
    expect(dark.edit).toBe(dark.loop)
    expect(dark.onEdit).toBe('#0A1220')
    expect(dark.onShare).toBe('#0A1220')
  })

  it('primaryStrong is the primary colour for text, icons and thin lines: dark teal on light, the same teal as before on dark', () => {
    expect(light.primaryStrong).toBe('#0F766E')
    expect(dark.primaryStrong).toBe(dark.primary)
  })

  it('the loop keeps its violet in both themes; the Edit map role is not the loop in light', () => {
    expect(light.loop).toBe('#7C3AED')
    expect(dark.loop).toBe('#A78BFA')
    expect(light.edit).not.toBe(light.loop)
  })

  it('anchor is readable as text on the light surfaces (4.5 to 1) and its label is white on it', () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
    expect(ratio(light.anchor, light.surface)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(light.anchor, light.background)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(light.onAnchor, light.anchor)).toBeGreaterThanOrEqual(4.5)
    expect(dark.anchor).toBe('#34D399')
    expect(dark.onAnchor).toBe(dark.onPrimary)
  })

  it('every label on a pastel fill and primaryStrong as text pass 4.5 to 1', () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
    expect(ratio(light.onPrimary, light.primary)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(light.onEdit, light.edit)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(light.onShare, light.share)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(light.primaryStrong, light.surface)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(light.primaryStrong, light.background)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(light.primaryStrong, light.surface2)).toBeGreaterThanOrEqual(4.5)
  })

  it('the glow of the big buttons: dark as today (25 %, 38 % on hover, 40 px), light stronger and tighter (70 %, 28 px)', () => {
    expect(tokens.glow.dark).toEqual({ strength: 25, hoverStrength: 38, reach: 40 })
    expect(tokens.glow.light).toEqual({ strength: 70, hoverStrength: 85, reach: 28 })
  })

  it('tokens.css puts the light waveform, glow and new roles in the light block only, and keeps dark in :root', () => {
    const css = renderCss(tokens)
    const [root, light] = css.split('[data-theme="light"]')
    expect(root).toContain('--lp-wave-low: #5EEAD4;')
    expect(root).toContain('--lp-glow-alpha: 25%;')
    expect(root).toContain('--lp-glow-reach: 40px;')
    expect(root).toContain('--lp-primary-strong: #5EEAD4;')
    expect(root).toContain('--lp-edit: #A78BFA;')
    expect(light).toContain('--lp-wave-low: #2B9E90;')
    expect(light).toContain('--lp-wave-mid: #8A6FE8;')
    expect(light).toContain('--lp-wave-high: #DB5F9F;')
    expect(light).toContain('--lp-glow-alpha: 70%;')
    expect(light).toContain('--lp-glow-alpha-hover: 85%;')
    expect(light).toContain('--lp-glow-reach: 28px;')
    expect(light).toContain('--lp-primary-strong: #0F766E;')
    expect(light).toContain('--lp-edit: #BDAAF7;')
  })
})

describe('cursorColours', () => {
  it('offers teal, amber, pink and blue, as the Settings swatches and the stored choices name them', () => {
    expect(Object.keys(tokens.cursorColours)).toEqual(['teal', 'amber', 'pink', 'blue'])
  })

  it('has blue as a swatch only: #3B82F6, and the loop role stays violet (Ruling R2)', () => {
    expect(tokens.cursorColours.blue).toBe('#3B82F6')
    expect(tokens.color.dark.loop).toBe('#A78BFA')
    expect(tokens.color.dark.loopHandle).toBe('#8B5CF6')
  })

  it('takes each colour from an existing role: the paper cursor, the selected bar and the loud end of the waveform', () => {
    expect(tokens.cursorColours.teal).toBe(tokens.color.dark.paperCursor)
    expect(tokens.cursorColours.amber).toBe(tokens.color.dark.selected)
    expect(tokens.cursorColours.pink).toBe(tokens.wave.high.dark)
  })

  it('leaves violet out: the fifth choice is painted from the loop role, which is violet already (cursorVar.violet = var(--lp-loop))', () => {
    expect(Object.keys(tokens.cursorColours)).not.toContain('violet')
    expect(tokens.color.dark.loop).toBe('#A78BFA')
    expect(renderCss(tokens)).toContain('--lp-loop: #A78BFA;')
  })

  it('is emitted as --lp-cursor-* variables in tokens.css and listed in DESIGN.md', () => {
    const css = renderCss(tokens)
    const designMd = renderDesignMd(tokens)
    for (const [name, value] of Object.entries(tokens.cursorColours)) {
      expect(css).toContain(`--lp-cursor-${name}: ${value};`)
      expect(designMd).toContain(`--lp-cursor-${name}`)
    }
  })
})

describe('no part colours (Decisions 2026-10-29)', () => {
  it('the tokens hold no part palette', () => {
    expect(Object.keys(tokens)).not.toContain('parts')
  })

  it('tokens.css generates no part variables', () => {
    expect(renderCss(tokens)).not.toMatch(/-part-/)
  })

  it('DESIGN.md has no part colours section', () => {
    expect(renderDesignMd(tokens)).not.toMatch(/part colou?r|-part-/i)
  })
})

describe('renderCss', () => {
  const css = renderCss(tokens)

  it('has the light theme block and the reduced-motion block', () => {
    expect(css).toContain('[data-theme="light"]')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('--lp-motion-base: 0ms;')
  })

  it('uses the --lp- names from the plan', () => {
    for (const name of [
      '--lp-background',
      '--lp-surface-2',
      '--lp-border-strong',
      '--lp-text-muted',
      '--lp-loop-tint',
      '--lp-flag-crowded-bg',
      '--lp-flag-weak-downbeat-text',
      '--lp-paper-cursor',
      '--lp-wave-low',
      '--lp-aurora-1',
      '--lp-aurora-4',
      '--lp-radius-md',
      '--lp-space-4',
      '--lp-touch-ipad',
      '--lp-motion-base',
      '--lp-font-sans',
    ]) {
      expect(css, name).toContain(`${name}:`)
    }
  })

  it('declares every variable once per block', () => {
    const blocks = css.split(/\n\n(?=\S)/).filter((b) => b.includes('{'))
    for (const block of blocks) {
      const names = [...block.matchAll(/^\s+(--lp-[\w-]+):/gm)].map((m) => m[1])
      expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([])
    }
  })

  it('is deterministic and ends with a newline', () => {
    expect(renderCss(tokens)).toBe(css)
    expect(css.endsWith('\n')).toBe(true)
    expect(renderDesignMd(tokens).endsWith('\n')).toBe(true)
  })
})
