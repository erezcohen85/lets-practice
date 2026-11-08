import { describe, expect, it } from 'vitest'
import { safePhotoUrl } from '@/domain/photoUrl'

describe('safePhotoUrl', () => {
  it('accepts an https address, as Google gives it', () => {
    expect(safePhotoUrl('https://lh3.googleusercontent.com/a/ACg8oc=s96-c')).toBe('https://lh3.googleusercontent.com/a/ACg8oc=s96-c')
  })

  it('refuses every other kind of address', () => {
    for (const raw of [
      'http://lh3.googleusercontent.com/a/x',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'blob:https://example.com/1',
      'ftp://example.com/a.png',
      '//lh3.googleusercontent.com/a/x',
      '/a/x.png',
      'a/x.png',
      'https://user:secret@lh3.googleusercontent.com/a/x',
      'https://',
      '',
      '   ',
    ]) {
      expect([raw, safePhotoUrl(raw)]).toEqual([raw, undefined])
    }
  })

  it('refuses what is not text', () => {
    for (const raw of [undefined, null, 7, {}, ['https://example.com/a.png']]) expect(safePhotoUrl(raw)).toBeUndefined()
  })

  it('ignores spaces around the address', () => {
    expect(safePhotoUrl('  https://example.com/a.png ')).toBe('https://example.com/a.png')
  })
})
