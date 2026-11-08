import { returnedFromGoogle, returnedWithCode, returnedWithError } from '@/domain/authReturn'

describe('returnedWithError', () => {
  it('sees an error Google (through Supabase) puts in the address fragment', () => {
    expect(returnedWithError('', '#error=access_denied&error_code=provider_email_needs_verification&error_description=Nope')).toBe(true)
    expect(returnedWithError('', '#error=server_error')).toBe(true)
  })

  it('sees an error in the query string', () => {
    expect(returnedWithError('?error=access_denied&error_description=Nope', '')).toBe(true)
    expect(returnedWithError('?next=%2Fjoin%2Fabc&error=access_denied', '')).toBe(true)
  })

  it('sees an error description on its own', () => {
    expect(returnedWithError('?error_description=Something+went+wrong', '')).toBe(true)
    expect(returnedWithError('', '#error_description=Something')).toBe(true)
  })

  it('is false for a plain address, a successful return and a fragment that is not a list of values', () => {
    expect(returnedWithError('', '')).toBe(false)
    expect(returnedWithError('?next=%2Fjoin%2Fabc', '')).toBe(false)
    expect(returnedWithError('', '#access_token=a&refresh_token=b&token_type=bearer')).toBe(false)
    expect(returnedWithError('?code=abc123', '')).toBe(false)
    expect(returnedWithError('', '#section-3')).toBe(false)
    expect(returnedWithError('', '#/error')).toBe(false)
  })

  it('does not take a word that merely contains error', () => {
    expect(returnedWithError('?errors=1&my_error=x', '#terror=1')).toBe(false)
  })

  it('is false for an empty value', () => {
    expect(returnedWithError('?error=', '#error=')).toBe(false)
  })
})

describe('returnedWithCode', () => {
  it('sees the one-time code the PKCE return carries in the query string', () => {
    expect(returnedWithCode('?code=abc123')).toBe(true)
    expect(returnedWithCode('?next=%2Fjoin%2Fabc&code=abc123')).toBe(true)
  })

  it('is false without a code, with an empty one, and for words that merely contain code', () => {
    expect(returnedWithCode('')).toBe(false)
    expect(returnedWithCode('?next=%2Flibrary')).toBe(false)
    expect(returnedWithCode('?code=')).toBe(false)
    expect(returnedWithCode('?barcode=1&code_x=2')).toBe(false)
  })
})

describe('returnedFromGoogle', () => {
  it('is true for an error or a code, in either place, and false for a plain address', () => {
    expect(returnedFromGoogle('?code=x', '')).toBe(true)
    expect(returnedFromGoogle('', '#error=access_denied')).toBe(true)
    expect(returnedFromGoogle('?error=access_denied', '')).toBe(true)
    expect(returnedFromGoogle('?next=%2Flibrary', '')).toBe(false)
  })
})
