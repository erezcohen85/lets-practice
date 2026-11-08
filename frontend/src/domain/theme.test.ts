import { describe, expect, it } from 'vitest'
import { themeFor } from '@/domain/theme'

describe('themeFor', () => {
  it('follows the signed-in user on the pages of the app', () => {
    expect(themeFor('/library', 'light')).toBe('light')
    expect(themeFor('/settings', 'light')).toBe('light')
    expect(themeFor('/pieces/p1/practice', 'light')).toBe('light')
    expect(themeFor('/library', 'dark')).toBe('dark')
  })

  it('is dark when nobody is signed in', () => {
    expect(themeFor('/library', null)).toBe('dark')
    expect(themeFor('/nowhere', null)).toBe('dark')
  })

  it.each(['/', '/terms', '/terms/', '/demo', '/demo/', '/demo/anything'])('is always dark on %s, even for a light user', (path) => {
    expect(themeFor(path, 'light')).toBe('dark')
  })

  it('does not take a page that only starts like a public one for a public one', () => {
    expect(themeFor('/demonstration', 'light')).toBe('light')
    expect(themeFor('/terms-of-use', 'light')).toBe('light')
  })
})
