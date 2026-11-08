import { describe, expect, it } from 'vitest'
import { safeNext } from '@/domain/nextPath'

describe('safeNext', () => {
  it.each(['/library', '/join/abc-_123', '/pieces/1/practice?part=2'])('keeps %j', (path) => {
    expect(safeNext(path)).toBe(path)
  })
  it.each([null, undefined, '', 'library', 'https://evil.com', '//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '/a b', '/a\\b', 'javascript:alert(1)'])(
    'refuses %j',
    (raw) => {
      expect(safeNext(raw)).toBeNull()
    },
  )
})
