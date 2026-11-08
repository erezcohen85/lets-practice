/**
 * Whether the address of the page holds an error from Google's return, which Supabase puts in the query string
 * (`?error=access_denied&error_description=...`) or, in the implicit flow, in the fragment (`#error=...`).
 * Only the fact is used: the text of the error is never shown (Decisions 2026-11-04).
 */
export function returnedWithError(search: string, hash: string): boolean {
  for (const text of [search.replace(/^\?/, ''), hash.replace(/^#/, '')]) {
    const params = new URLSearchParams(text)
    if ((params.get('error') ?? '') !== '' || (params.get('error_description') ?? '') !== '') return true
  }
  return false
}

/**
 * Whether the address holds the one-time `code` of a PKCE return from Google. The library exchanges it and removes it
 * from the address on success; one that is still there when no session follows means the exchange failed (refused, no
 * network, or the verifier is missing in this browser) and carries no `error` of its own.
 */
export function returnedWithCode(search: string): boolean {
  return (new URLSearchParams(search.replace(/^\?/, '')).get('code') ?? '') !== ''
}

/** A return from Google that may have failed: an error in the address, or a code that must still turn into a session. */
export function returnedFromGoogle(search: string, hash: string): boolean {
  return returnedWithError(search, hash) || returnedWithCode(search)
}
