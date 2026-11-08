import { LOOP_COLOURS } from '@/lib/dataClient'
import { loopVars } from './loopColour'

describe('loopVars', () => {
  it('maps violet to the existing loop tokens, so the loop looks exactly as it did', () => {
    expect(loopVars('violet')).toEqual({
      '--lp-loop-user': 'var(--lp-loop)',
      '--lp-loop-user-soft': 'var(--lp-loop-soft)',
      '--lp-loop-user-tint': 'var(--lp-loop-tint)',
      '--lp-loop-user-handle': 'var(--lp-loop-handle)',
    })
  })

  it('derives soft, tint and handle from the colour token for every other colour', () => {
    for (const colour of LOOP_COLOURS.filter((c) => c !== 'violet')) {
      const vars = loopVars(colour)
      expect(vars['--lp-loop-user']).toBe(`var(--lp-cursor-${colour})`)
      expect(vars['--lp-loop-user-soft']).toContain(`var(--lp-cursor-${colour})`)
      expect(vars['--lp-loop-user-soft']).toContain('color-mix(')
      expect(vars['--lp-loop-user-tint']).toMatch(/^color-mix\(in oklab, var\(--lp-cursor-\w+\) 18%, transparent\)$/)
      expect(vars['--lp-loop-user-handle']).toContain(`var(--lp-cursor-${colour})`)
    }
  })

  it('does not touch the loop token itself, which keeps its other jobs', () => {
    for (const colour of LOOP_COLOURS) expect(Object.keys(loopVars(colour))).not.toContain('--lp-loop')
  })
})
