import { describe, expect, it } from 'vitest'
import { can, normalizeEmail, roleOf, type PieceAction, type Role } from '@/domain/access'

describe('roleOf', () => {
  it('is owner for the owner and viewer for anyone else', () => {
    expect(roleOf({ ownerId: 'a' }, 'a')).toBe('owner')
    expect(roleOf({ ownerId: 'a' }, 'b')).toBe('viewer')
  })
})

describe('can', () => {
  const table: Array<[PieceAction, Role, boolean]> = [
    ['practise', 'owner', true], ['practise', 'viewer', true],
    ['edit', 'owner', true], ['edit', 'viewer', false],
    ['review', 'owner', true], ['review', 'viewer', false],
    ['share', 'owner', true], ['share', 'viewer', false],
    ['leave', 'owner', false], ['leave', 'viewer', true],
  ]
  it.each(table)('%s by %s is %s', (action, role, allowed) => {
    expect(can(role, action)).toBe(allowed)
  })
})

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Dana@Example.COM ')).toBe('dana@example.com')
  })
  it.each(['', '   ', 'dana', 'dana@', '@example.com', 'dana@example', 'a b@example.com', 'a@b@example.com'])('refuses %j', (text) => {
    expect(normalizeEmail(text)).toBeNull()
  })
})
