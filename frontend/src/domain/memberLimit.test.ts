import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MEMBERS_PER_PART,
  DEFAULT_MEMBERS_PER_PIECE,
  memberLimit,
  membersOnHold,
  validMembersPerPart,
  validMembersPerPiece,
} from './memberLimit'

describe('memberLimit', () => {
  it('with the defaults: 30 for one to three parts, 40 for four, 140 for fourteen', () => {
    expect(DEFAULT_MEMBERS_PER_PIECE).toBe(30)
    expect(DEFAULT_MEMBERS_PER_PART).toBe(10)
    const limit = (parts: number) => memberLimit(DEFAULT_MEMBERS_PER_PIECE, DEFAULT_MEMBERS_PER_PART, parts)
    expect([1, 2, 3].map(limit)).toEqual([30, 30, 30])
    expect(limit(4)).toBe(40)
    expect(limit(14)).toBe(140)
  })

  it('takes the larger of the two numbers', () => {
    expect(memberLimit(5, 2, 1)).toBe(5)
    expect(memberLimit(5, 2, 3)).toBe(6)
    expect(memberLimit(50, 0, 14)).toBe(50)
  })

  it('a piece with no parts yet still admits the per piece number', () => {
    expect(memberLimit(30, 10, 0)).toBe(30)
  })
})

describe('membersOnHold', () => {
  const at = (second: number) => new Date(Date.UTC(2026, 10, 1, 10, 0, second)).toISOString()

  it('is nobody while the members fit', () => {
    expect(membersOnHold([{ userId: 'a', joinedAt: at(0) }, { userId: 'b', joinedAt: at(1) }], 2)).toEqual(new Set())
    expect(membersOnHold([], 1)).toEqual(new Set())
  })

  it('is the newest joiners over the limit, whatever order the list comes in', () => {
    const members = [
      { userId: 'd', joinedAt: at(3) },
      { userId: 'a', joinedAt: at(0) },
      { userId: 'c', joinedAt: at(2) },
      { userId: 'b', joinedAt: at(1) },
    ]
    expect(membersOnHold(members, 2)).toEqual(new Set(['c', 'd']))
    expect(membersOnHold(members, 3)).toEqual(new Set(['d']))
  })

  it('breaks a tie in the join time by user id, as the database does', () => {
    const members = [
      { userId: 'b', joinedAt: at(0) },
      { userId: 'a', joinedAt: at(0) },
    ]
    expect(membersOnHold(members, 1)).toEqual(new Set(['b']))
  })

  it('compares join times as times, not as text', () => {
    // The same moment written two ways; the later one by the clock is on hold.
    const members = [
      { userId: 'a', joinedAt: '2026-11-01T10:00:00.500+00:00' },
      { userId: 'b', joinedAt: '2026-11-01T10:00:00.400Z' },
    ]
    expect(membersOnHold(members, 1)).toEqual(new Set(['a']))
  })
})

describe('the admin\'s bounds', () => {
  it('members per piece is a whole number from 1 to 500', () => {
    expect([1, 30, 500].map(validMembersPerPiece)).toEqual([true, true, true])
    expect([0, 501, 2.5, Number.NaN].map(validMembersPerPiece)).toEqual([false, false, false, false])
  })

  it('members per part is a whole number from 0 to 100', () => {
    expect([0, 10, 100].map(validMembersPerPart)).toEqual([true, true, true])
    expect([-1, 101, 0.5, Number.NaN].map(validMembersPerPart)).toEqual([false, false, false, false])
  })
})
