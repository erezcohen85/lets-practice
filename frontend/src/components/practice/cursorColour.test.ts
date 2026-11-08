import { LOOP_COLOURS } from '@/lib/dataClient'
import { cursorVar } from './cursorColour'

describe('cursorVar', () => {
  it('has a token for each of the five colours the settings offer, violet being the loop token', () => {
    expect(Object.keys(cursorVar).sort()).toEqual([...LOOP_COLOURS].sort())
    expect(cursorVar.violet).toBe('var(--lp-loop)')
    expect(cursorVar.teal).toBe('var(--lp-cursor-teal)')
  })
})
