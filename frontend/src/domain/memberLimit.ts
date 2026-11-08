/**
 * The member limit of a piece (Erez, 2026-11-07; migration 0014): a piece admits the larger of members per piece, or members
 * per part times its number of parts. The admin sets both per creator; an owner with no creator row gets the defaults. Over the
 * limit, the newest joiners are on hold: still members, with no access, until there is room again. The fake data client works
 * the hold out with these, so the fake and the database agree.
 */
export const DEFAULT_MEMBERS_PER_PIECE = 30
export const DEFAULT_MEMBERS_PER_PART = 10
/** The bounds of the two numbers, as the database's check constraints. */
export const MEMBERS_PER_PIECE_RANGE = { min: 1, max: 500 } as const
export const MEMBERS_PER_PART_RANGE = { min: 0, max: 100 } as const

export function memberLimit(perPiece: number, perPart: number, partCount: number): number {
  return Math.max(perPiece, perPart * partCount)
}

export interface JoinedMember { userId: string; joinedAt: string }

/** Oldest first: by the join time, then by user id when two joined at the same moment (as the database orders them). */
function byJoinOrder(a: JoinedMember, b: JoinedMember): number {
  const time = Date.parse(a.joinedAt) - Date.parse(b.joinedAt)
  if (time !== 0) return time
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
}

/** The ids of the members on hold: everyone after the first `limit` in join order. */
export function membersOnHold(members: readonly JoinedMember[], limit: number): Set<string> {
  return new Set([...members].sort(byJoinOrder).slice(Math.max(0, limit)).map((member) => member.userId))
}

const within = (value: number, range: { min: number; max: number }) => Number.isInteger(value) && value >= range.min && value <= range.max

export function validMembersPerPiece(value: number): boolean {
  return within(value, MEMBERS_PER_PIECE_RANGE)
}

export function validMembersPerPart(value: number): boolean {
  return within(value, MEMBERS_PER_PART_RANGE)
}
