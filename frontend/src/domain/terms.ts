/** The version of the user agreement in strings.ts. A change that matters gets a new version, and everyone accepts again. */
export const TERMS_VERSION = '2026-11-07'

export function needsTerms(profile: { acceptedTermsAt: string | null; acceptedTermsVersion: string | null }): boolean {
  return profile.acceptedTermsAt === null || profile.acceptedTermsVersion !== TERMS_VERSION
}
