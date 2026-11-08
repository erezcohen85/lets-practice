import { describe, expect, it } from 'vitest'
import { needsTerms, TERMS_VERSION } from '@/domain/terms'

describe('needsTerms', () => {
  it('is true with no acceptance', () => {
    expect(needsTerms({ acceptedTermsAt: null, acceptedTermsVersion: null })).toBe(true)
  })
  it('is true for an older version, and for an acceptance with no version', () => {
    expect(needsTerms({ acceptedTermsAt: '2026-10-01T00:00:00Z', acceptedTermsVersion: '2020-01-01' })).toBe(true)
    expect(needsTerms({ acceptedTermsAt: '2026-10-01T00:00:00Z', acceptedTermsVersion: null })).toBe(true)
  })
  it('is true for the version before the delete-account and profile-picture change, so everyone accepts once more', () => {
    expect(needsTerms({ acceptedTermsAt: '2026-11-03T00:00:00Z', acceptedTermsVersion: '2026-11-02' })).toBe(true)
  })
  it('is true for the version before the copyright rewrite (2026-11-07), so everyone accepts the new terms once', () => {
    expect(TERMS_VERSION).toBe('2026-11-07')
    expect(needsTerms({ acceptedTermsAt: '2026-11-06T00:00:00Z', acceptedTermsVersion: '2026-11-05' })).toBe(true)
  })
  it('is false for the current version', () => {
    expect(needsTerms({ acceptedTermsAt: '2026-11-03T00:00:00Z', acceptedTermsVersion: TERMS_VERSION })).toBe(false)
  })
})
