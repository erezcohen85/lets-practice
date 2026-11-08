import { describe, expect, it } from 'vitest'
import {
  LIMIT_GROUPS,
  PLAN_LIMITS,
  allowed,
  parseLimitError,
  type LimitKey,
  type PlanAction,
  type PlanRow,
  type PlanState,
} from './planLimits'

/** Every key of the LimitKey union, in the contract's order. A key added to the union but missing here fails typecheck. */
const KEYS_IN_ORDER = [
  'pieces_created_max',
  'pieces_stored_max',
  'parts_per_piece_max',
  'pages_per_part_max',
  'recording_minutes_max',
  'advanced_reading',
  'advanced_reading_parts_per_month',
  'split_pdf',
  'suggest_name',
  'shared_pieces_max',
  'members_per_piece',
  'members_per_part',
  'read_again_per_part_max',
  'realign_per_piece_max',
  'new_pieces_per_day',
  'new_pieces_paused',
] as const satisfies readonly LimitKey[]

type Missing = Exclude<LimitKey, (typeof KEYS_IN_ORDER)[number]>
const NONE_MISSING: Missing extends never ? true : false = true

const TRIAL: PlanRow = {
  id: 'trial',
  name: 'Trial',
  position: 0,
  pieces_created_max: 3,
  pieces_stored_max: 3,
  parts_per_piece_max: 1,
  pages_per_part_max: 20,
  recording_minutes_max: 10,
  advanced_reading: false,
  advanced_reading_parts_per_month: 0,
  split_pdf: false,
  suggest_name: true,
  shared_pieces_max: 1,
  members_per_piece: 30,
  members_per_part: 10,
  read_again_per_part_max: 2,
  realign_per_piece_max: 5,
  new_pieces_per_day: 20,
  new_pieces_paused: false,
}

const NO_LIMITS: PlanRow = {
  ...TRIAL,
  id: 'unlimited',
  name: 'Unlimited',
  position: 2,
  pieces_created_max: null,
  pieces_stored_max: null,
  parts_per_piece_max: null,
  pages_per_part_max: null,
  recording_minutes_max: null,
  advanced_reading: true,
  advanced_reading_parts_per_month: null,
  split_pdf: true,
  shared_pieces_max: null,
  read_again_per_part_max: null,
  realign_per_piece_max: null,
  new_pieces_per_day: null,
}

function state(over: { plan?: Partial<PlanRow>; usage?: Partial<PlanState['usage']>; piece?: PlanState['piece']; admin?: boolean } = {}): PlanState {
  return {
    is_admin: over.admin ?? false,
    plan: { ...TRIAL, ...over.plan },
    usage: {
      pieces_created: 0,
      pieces_stored: 0,
      shared_pieces: 0,
      advanced_reading_parts_this_month: 0,
      new_pieces_today_on_plan: 0,
      ...over.usage,
    },
    piece: over.piece ?? null,
  }
}

const piece = (over: Partial<NonNullable<PlanState['piece']>> = {}) => ({ id: 'p1', parts: 1, realigns: 0, read_again_by_part: {}, ...over })

const ok = { ok: true }
const refused = (limit: LimitKey) => ({ ok: false, limit })

describe('the limits list', () => {
  it('lists every key of the LimitKey union once, in the contract order', () => {
    expect(NONE_MISSING).toBe(true)
    expect(PLAN_LIMITS.map((limit) => limit.key)).toEqual(KEYS_IN_ORDER)
    expect(new Set(PLAN_LIMITS.map((limit) => limit.key)).size).toBe(PLAN_LIMITS.length)
  })

  it('has the groups in display order, each with at least one limit, and no limit in an unknown group', () => {
    expect(LIMIT_GROUPS).toEqual(['pieces', 'size', 'ai', 'sharing', 'reprocess', 'planWide'])
    for (const group of LIMIT_GROUPS) expect(PLAN_LIMITS.some((limit) => limit.group === group)).toBe(true)
    for (const limit of PLAN_LIMITS) expect(LIMIT_GROUPS).toContain(limit.group)
  })

  it('keeps the limits of a group together and in group order', () => {
    const groups = PLAN_LIMITS.map((limit) => limit.group)
    const firstSeen = LIMIT_GROUPS.map((group) => groups.indexOf(group))
    expect(firstSeen).toEqual([...firstSeen].sort((a, b) => a - b))
    for (const group of LIMIT_GROUPS) {
      const at = groups.map((g, i) => (g === group ? i : -1)).filter((i) => i >= 0)
      expect(at[at.length - 1]! - at[0]!).toBe(at.length - 1)
    }
  })

  it('marks the four switches, and every other limit is a count', () => {
    const switches = PLAN_LIMITS.filter((limit) => limit.kind === 'switch').map((limit) => limit.key)
    expect(switches).toEqual(['advanced_reading', 'split_pdf', 'suggest_name', 'new_pieces_paused'])
  })

  it('has the bounds of the plans table: the hard ceilings, the minimums, and which counts may be empty', () => {
    const def = (key: LimitKey) => PLAN_LIMITS.find((limit) => limit.key === key)!
    expect(def('pages_per_part_max')).toMatchObject({ min: 1, ceiling: 100, nullable: true })
    expect(def('recording_minutes_max')).toMatchObject({ min: 1, ceiling: 20, nullable: true })
    expect(def('parts_per_piece_max')).toMatchObject({ min: 1, ceiling: null, nullable: true })
    expect(def('pieces_created_max')).toMatchObject({ min: 0, ceiling: null, nullable: true })
    expect(def('members_per_piece')).toMatchObject({ min: 1, ceiling: 500, nullable: false })
    expect(def('members_per_part')).toMatchObject({ min: 0, ceiling: 100, nullable: false })
    for (const limit of PLAN_LIMITS.filter((l) => l.kind === 'switch')) expect(limit.nullable).toBe(false)
  })
})

describe('allowed: the admin and the empty limits', () => {
  const everyAction: PlanAction[] = [
    { type: 'createPiece' },
    { type: 'addPart', partsAfter: 99 },
    { type: 'splitPdf' },
    { type: 'advancedReading', parts: 99 },
    { type: 'suggestName' },
    { type: 'recording', seconds: 99999 },
    { type: 'shareOn' },
    { type: 'readAgain', partId: 'a' },
    { type: 'realign' },
  ]

  it('lets the admin do anything, even on a paused and used-up plan', () => {
    const everything = state({
      admin: true,
      plan: { new_pieces_paused: true, suggest_name: false },
      usage: { pieces_created: 9, pieces_stored: 9, shared_pieces: 9, advanced_reading_parts_this_month: 9, new_pieces_today_on_plan: 99 },
      piece: piece({ realigns: 99, read_again_by_part: { a: 99 } }),
    })
    for (const action of everyAction) expect(allowed(everything, action)).toEqual(ok)
  })

  it('treats a null limit as no limit', () => {
    const open = { ...state(), plan: NO_LIMITS, usage: { pieces_created: 500, pieces_stored: 500, shared_pieces: 500, advanced_reading_parts_this_month: 500, new_pieces_today_on_plan: 500 }, piece: piece({ realigns: 500, read_again_by_part: { a: 500 } }) }
    for (const action of everyAction) expect(allowed(open, action)).toEqual(ok)
  })
})

describe('allowed: createPiece', () => {
  it('refuses when new pieces are paused', () => {
    expect(allowed(state({ plan: { new_pieces_paused: true } }), { type: 'createPiece' })).toEqual(refused('new_pieces_paused'))
  })

  it('refuses at the daily cap and allows one below it', () => {
    expect(allowed(state({ usage: { new_pieces_today_on_plan: 19 } }), { type: 'createPiece' })).toEqual(ok)
    expect(allowed(state({ usage: { new_pieces_today_on_plan: 20 } }), { type: 'createPiece' })).toEqual(refused('new_pieces_per_day'))
  })

  it('refuses at the pieces created limit: 2 of 3 allowed, 3 of 3 refused', () => {
    expect(allowed(state({ usage: { pieces_created: 2, pieces_stored: 2 } }), { type: 'createPiece' })).toEqual(ok)
    expect(allowed(state({ usage: { pieces_created: 3, pieces_stored: 0 } }), { type: 'createPiece' })).toEqual(refused('pieces_created_max'))
  })

  it('refuses at the pieces stored limit even when few were ever created', () => {
    const creator = { pieces_created_max: null, pieces_stored_max: 2 }
    expect(allowed(state({ plan: creator, usage: { pieces_created: 9, pieces_stored: 1 } }), { type: 'createPiece' })).toEqual(ok)
    expect(allowed(state({ plan: creator, usage: { pieces_created: 9, pieces_stored: 2 } }), { type: 'createPiece' })).toEqual(refused('pieces_stored_max'))
  })

  it('names the first failing check: paused, then the day, then created, then stored', () => {
    const everything = { new_pieces_paused: true }
    const used = { new_pieces_today_on_plan: 20, pieces_created: 3, pieces_stored: 3 }
    expect(allowed(state({ plan: everything, usage: used }), { type: 'createPiece' })).toEqual(refused('new_pieces_paused'))
    expect(allowed(state({ usage: used }), { type: 'createPiece' })).toEqual(refused('new_pieces_per_day'))
    expect(allowed(state({ usage: { ...used, new_pieces_today_on_plan: 0 } }), { type: 'createPiece' })).toEqual(refused('pieces_created_max'))
    expect(allowed(state({ plan: { pieces_created_max: null }, usage: { ...used, new_pieces_today_on_plan: 0 } }), { type: 'createPiece' })).toEqual(refused('pieces_stored_max'))
  })

  it('a plan that kept more pieces than it now allows is over the limit, not under', () => {
    expect(allowed(state({ usage: { pieces_created: 4, pieces_stored: 4 } }), { type: 'createPiece' })).toEqual(refused('pieces_created_max'))
  })
})

describe('allowed: the size of a piece', () => {
  it('addPart checks the parts the piece would have: 1 of 1 allowed, 2 refused', () => {
    expect(allowed(state(), { type: 'addPart', partsAfter: 1 })).toEqual(ok)
    expect(allowed(state(), { type: 'addPart', partsAfter: 2 })).toEqual(refused('parts_per_piece_max'))
  })

  it('addPart on a plan of three parts allows the third and refuses the fourth', () => {
    const three = { parts_per_piece_max: 3 }
    expect(allowed(state({ plan: three }), { type: 'addPart', partsAfter: 3 })).toEqual(ok)
    expect(allowed(state({ plan: three }), { type: 'addPart', partsAfter: 4 })).toEqual(refused('parts_per_piece_max'))
  })

  it('recording: 600 seconds at 10 minutes is allowed, 601 is refused', () => {
    expect(allowed(state(), { type: 'recording', seconds: 600 })).toEqual(ok)
    expect(allowed(state(), { type: 'recording', seconds: 601 })).toEqual(refused('recording_minutes_max'))
  })

  it('splitPdf needs the switch', () => {
    expect(allowed(state(), { type: 'splitPdf' })).toEqual(refused('split_pdf'))
    expect(allowed(state({ plan: { split_pdf: true } }), { type: 'splitPdf' })).toEqual(ok)
  })
})

describe('allowed: the AI features', () => {
  it('advancedReading needs the switch first, whatever the month holds', () => {
    expect(allowed(state(), { type: 'advancedReading', parts: 1 })).toEqual(refused('advanced_reading'))
  })

  it('advancedReading counts the month: 30 used of 30 refuses one more, 29 used allows one', () => {
    const creator = { advanced_reading: true, advanced_reading_parts_per_month: 30 }
    expect(allowed(state({ plan: creator, usage: { advanced_reading_parts_this_month: 29 } }), { type: 'advancedReading', parts: 1 })).toEqual(ok)
    expect(allowed(state({ plan: creator, usage: { advanced_reading_parts_this_month: 30 } }), { type: 'advancedReading', parts: 1 })).toEqual(refused('advanced_reading_parts_per_month'))
  })

  it('advancedReading checks the parts it would add: 28 used and 3 parts is over 30', () => {
    const creator = { advanced_reading: true, advanced_reading_parts_per_month: 30 }
    expect(allowed(state({ plan: creator, usage: { advanced_reading_parts_this_month: 28 } }), { type: 'advancedReading', parts: 2 })).toEqual(ok)
    expect(allowed(state({ plan: creator, usage: { advanced_reading_parts_this_month: 28 } }), { type: 'advancedReading', parts: 3 })).toEqual(refused('advanced_reading_parts_per_month'))
  })

  it('advancedReading with the switch on and no monthly limit is allowed', () => {
    expect(allowed(state({ plan: { advanced_reading: true, advanced_reading_parts_per_month: null }, usage: { advanced_reading_parts_this_month: 900 } }), { type: 'advancedReading', parts: 5 })).toEqual(ok)
  })

  it('suggestName needs the switch', () => {
    expect(allowed(state(), { type: 'suggestName' })).toEqual(ok)
    expect(allowed(state({ plan: { suggest_name: false } }), { type: 'suggestName' })).toEqual(refused('suggest_name'))
  })
})

describe('allowed: sharing and reprocessing', () => {
  it('shareOn: 0 of 1 shared allowed, 1 of 1 refused', () => {
    expect(allowed(state({ usage: { shared_pieces: 0 } }), { type: 'shareOn' })).toEqual(ok)
    expect(allowed(state({ usage: { shared_pieces: 1 } }), { type: 'shareOn' })).toEqual(refused('shared_pieces_max'))
  })

  it('readAgain counts per part: 1 of 2 allowed, 2 of 2 refused, another part is untouched', () => {
    const at = (n: number) => state({ piece: piece({ read_again_by_part: { a: n, b: 0 } }) })
    expect(allowed(at(1), { type: 'readAgain', partId: 'a' })).toEqual(ok)
    expect(allowed(at(2), { type: 'readAgain', partId: 'a' })).toEqual(refused('read_again_per_part_max'))
    expect(allowed(at(2), { type: 'readAgain', partId: 'b' })).toEqual(ok)
    expect(allowed(at(2), { type: 'readAgain', partId: 'never-read' })).toEqual(ok)
  })

  it('realign counts per piece: 4 of 5 allowed, 5 of 5 refused', () => {
    expect(allowed(state({ piece: piece({ realigns: 4 }) }), { type: 'realign' })).toEqual(ok)
    expect(allowed(state({ piece: piece({ realigns: 5 }) }), { type: 'realign' })).toEqual(refused('realign_per_piece_max'))
  })

  it('readAgain and realign without a piece in the state are allowed: the server decides', () => {
    expect(allowed(state({ piece: null }), { type: 'readAgain', partId: 'a' })).toEqual(ok)
    expect(allowed(state({ piece: null }), { type: 'realign' })).toEqual(ok)
  })
})

describe('parseLimitError', () => {
  it('turns plan_limit:<key> into the key, for every key', () => {
    for (const key of KEYS_IN_ORDER) expect(parseLimitError(`plan_limit:${key}`)).toBe(key)
  })

  it('finds the key inside a longer database message', () => {
    expect(parseLimitError('Error: plan_limit:shared_pieces_max (P0001)')).toBe('shared_pieces_max')
  })

  it('returns null for anything else, including an unknown key and the browser-side plan_limit:pieces', () => {
    expect(parseLimitError('')).toBeNull()
    expect(parseLimitError('permission denied')).toBeNull()
    expect(parseLimitError('plan_limit:')).toBeNull()
    expect(parseLimitError('plan_limit:nonsense')).toBeNull()
    expect(parseLimitError('plan_limit:pieces')).toBeNull()
    expect(parseLimitError('plan_limit:pieces_created_max_extra')).toBeNull()
  })
})
