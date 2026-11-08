/**
 * A profile photo address, only if it is an https address with no sign-in in it (Google's are https://lh3.googleusercontent.com/...).
 * Anything else is no photo: the page would otherwise load whatever address a sign-in provider put in the profile, over
 * plain http or as a script address.
 */
export function safePhotoUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.hostname === '' || url.username !== '' || url.password !== '') return undefined
  return url.href
}
