/**
 * The limits of a plan (Erez, 2026-11-08; migration 0015, "Plans and usage limits"). One list of limit keys, the same keys as the
 * `plans` columns and the processor's copy, and a pure `allowed` that lets the browser show the "Not in your plan" prompt early.
 * The server decides: the database and the processor refuse the same actions, and a refusal reaches the browser as
 * `plan_limit:<key>`. A null count limit means no limit. The admin is never limited.
 */
export type LimitGroup = 'pieces' | 'size' | 'ai' | 'sharing' | 'reprocess' | 'planWide'
export type LimitKey =
  | 'pieces_created_max'
  | 'pieces_stored_max'
  | 'parts_per_piece_max'
  | 'pages_per_part_max'
  | 'recording_minutes_max'
  | 'advanced_reading'
  | 'advanced_reading_parts_per_month'
  | 'split_pdf'
  | 'suggest_name'
  | 'shared_pieces_max'
  | 'members_per_piece'
  | 'members_per_part'
  | 'read_again_per_part_max'
  | 'realign_per_piece_max'
  | 'new_pieces_per_day'
  | 'new_pieces_paused'

/**
 * One limit. `min` and `ceiling` are the bounds of the `plans` column's check (the code's hard ceilings: 100 pages, 20 minutes of
 * recording, 500 and 100 members); `nullable` is whether the column may be null (no limit). Switches have min 0, no ceiling and
 * are never null.
 */
export interface LimitDef {
  key: LimitKey
  group: LimitGroup
  kind: 'count' | 'switch'
  min: number
  ceiling: number | null
  nullable: boolean
}

/** The groups in display order. */
export const LIMIT_GROUPS = ['pieces', 'size', 'ai', 'sharing', 'reprocess', 'planWide'] as const satisfies readonly LimitGroup[]

const count = (key: LimitKey, group: LimitGroup, min: number, ceiling: number | null, nullable: boolean): LimitDef => ({ key, group, kind: 'count', min, ceiling, nullable })
const toggle = (key: LimitKey, group: LimitGroup): LimitDef => ({ key, group, kind: 'switch', min: 0, ceiling: null, nullable: false })

/** Every limit, in the contract's order (and the order of the `plans` columns). */
export const PLAN_LIMITS: readonly LimitDef[] = [
  count('pieces_created_max', 'pieces', 0, null, true),
  count('pieces_stored_max', 'pieces', 0, null, true),
  count('parts_per_piece_max', 'size', 1, null, true),
  count('pages_per_part_max', 'size', 1, 100, true),
  count('recording_minutes_max', 'size', 1, 20, true),
  toggle('advanced_reading', 'ai'),
  count('advanced_reading_parts_per_month', 'ai', 0, null, true),
  toggle('split_pdf', 'ai'),
  toggle('suggest_name', 'ai'),
  count('shared_pieces_max', 'sharing', 0, null, true),
  count('members_per_piece', 'sharing', 1, 500, false),
  count('members_per_part', 'sharing', 0, 100, false),
  count('read_again_per_part_max', 'reprocess', 0, null, true),
  count('realign_per_piece_max', 'reprocess', 0, null, true),
  count('new_pieces_per_day', 'planWide', 0, null, true),
  toggle('new_pieces_paused', 'planWide'),
]

export type PlanId = 'trial' | 'creator' | 'unlimited'

/** A `plans` row as `my_plan()` and `admin_overview()` return it. */
export type PlanRow = { id: PlanId; name: string; position: number } & {
  [K in LimitKey]: K extends 'advanced_reading' | 'split_pdf' | 'suggest_name' | 'new_pieces_paused' ? boolean : number | null
}

export interface PlanUsage {
  pieces_created: number
  pieces_stored: number
  shared_pieces: number
  advanced_reading_parts_this_month: number
  new_pieces_today_on_plan: number
}

export interface PieceUsage {
  id: string
  parts: number
  realigns: number
  read_again_by_part: Record<string, number>
}

/** What `my_plan()` returns. `piece` is present only when a piece of the user's was asked for. */
export interface PlanState {
  is_admin: boolean
  plan: PlanRow
  usage: PlanUsage
  piece: PieceUsage | null
}

export type PlanAction =
  | { type: 'createPiece' }
  | { type: 'addPart'; partsAfter: number }
  | { type: 'splitPdf' }
  | { type: 'advancedReading'; parts: number }
  | { type: 'suggestName' }
  | { type: 'recording'; seconds: number }
  | { type: 'shareOn' }
  | { type: 'readAgain'; partId: string }
  | { type: 'realign' }

export type Verdict = { ok: true } | { ok: false; limit: LimitKey }

const OK: Verdict = { ok: true }
const refuse = (limit: LimitKey): Verdict => ({ ok: false, limit })

/** True when a count limit with a number is used up: `used` is at or over it. Null = no limit. */
const usedUp = (used: number, max: number | null) => max !== null && used >= max

/** The first failing check of the first group, or ok. Mirrors the database and the processor; the server has the last word. */
export function allowed(state: PlanState, action: PlanAction): Verdict {
  if (state.is_admin) return OK
  const { plan, usage, piece } = state
  switch (action.type) {
    case 'createPiece':
      if (plan.new_pieces_paused) return refuse('new_pieces_paused')
      if (usedUp(usage.new_pieces_today_on_plan, plan.new_pieces_per_day)) return refuse('new_pieces_per_day')
      if (usedUp(usage.pieces_created, plan.pieces_created_max)) return refuse('pieces_created_max')
      if (usedUp(usage.pieces_stored, plan.pieces_stored_max)) return refuse('pieces_stored_max')
      return OK
    case 'addPart':
      return plan.parts_per_piece_max !== null && action.partsAfter > plan.parts_per_piece_max ? refuse('parts_per_piece_max') : OK
    case 'splitPdf':
      return plan.split_pdf ? OK : refuse('split_pdf')
    case 'advancedReading':
      if (!plan.advanced_reading) return refuse('advanced_reading')
      if (plan.advanced_reading_parts_per_month !== null && usage.advanced_reading_parts_this_month + action.parts > plan.advanced_reading_parts_per_month) {
        return refuse('advanced_reading_parts_per_month')
      }
      return OK
    case 'suggestName':
      return plan.suggest_name ? OK : refuse('suggest_name')
    case 'recording':
      return plan.recording_minutes_max !== null && action.seconds > plan.recording_minutes_max * 60 ? refuse('recording_minutes_max') : OK
    case 'shareOn':
      return usedUp(usage.shared_pieces, plan.shared_pieces_max) ? refuse('shared_pieces_max') : OK
    case 'readAgain':
      if (!piece) return OK
      return usedUp(piece.read_again_by_part[action.partId] ?? 0, plan.read_again_per_part_max) ? refuse('read_again_per_part_max') : OK
    case 'realign':
      if (!piece) return OK
      return usedUp(piece.realigns, plan.realign_per_piece_max) ? refuse('realign_per_piece_max') : OK
  }
}

const KEYS: ReadonlySet<string> = new Set(PLAN_LIMITS.map((limit) => limit.key))

/** The limit a refusal names: `plan_limit:<key>` anywhere in the text gives the key; anything else (or an unknown key) gives null. */
export function parseLimitError(text: string): LimitKey | null {
  const key = /plan_limit:([a-z_]+)/.exec(text)?.[1]
  return key !== undefined && KEYS.has(key) ? (key as LimitKey) : null
}
